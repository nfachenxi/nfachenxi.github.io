/**
 * 线路切换功能
 * Route Switch Feature
 */

const RouteSwitch = {
  config: {
    storageKey: 'preferred_route',
    pingTimeout: 5000,
    checkInterval: 30000, // 30秒检测一次
  },

  // 运行时状态（不暴露给外部）
  _intervalId: null,
  _checking: false,

  /**
   * 初始化
   */
  init() {
    if (!window.routeSwitchConfig || !window.routeSwitchConfig.enable) return;

    this.routes = window.routeSwitchConfig.routes || [];
    if (this.routes.length === 0) return;

    // 清理旧 interval，防止 PJAX 导航叠加多个定时器
    if (this._intervalId) {
      clearInterval(this._intervalId);
    }

    // 首次立即检测
    this.checkAllRoutes();
    this._intervalId = setInterval(() => this.checkAllRoutes(), this.config.checkInterval);

    this.bindEvents();

    // 校验 localStorage 中的偏好是否仍在当前线路配置中
    const preferred = localStorage.getItem(this.config.storageKey);
    if (preferred) {
      const routeExists = this.routes.some(r => r.name === preferred);
      if (!routeExists) {
        localStorage.removeItem(this.config.storageKey);
      }
    }

    // 延迟检查当前线路健康状态（等第一轮检测完成）
    setTimeout(() => this.checkCurrentRouteHealth(), 3000);
  },

  /**
   * 检测所有线路延迟（串行执行，避免连接风暴）
   */
  async checkAllRoutes() {
    if (this._checking) return; // 已有检测进行中，跳过本轮
    this._checking = true;

    for (const route of this.routes) {
      await this.checkRouteLatency(route);
    }

    this._checking = false;
  },

  /**
   * 检测单个线路延迟
   */
  async checkRouteLatency(route) {
    const routeItem = document.querySelector(`.route-item[data-name="${route.name}"]`);
    if (!routeItem) return;

    const pingValue = routeItem.querySelector('.ping-value');
    const statusIcon = routeItem.querySelector('.route-status i');
    
    try {
      const startTime = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.pingTimeout);

      // 尝试多种检测方式
      let response;
      try {
        // 首先尝试 ping.txt
        response = await fetch(`${route.url}/ping.txt?_=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          mode: 'no-cors', // 使用 no-cors 模式避免 CORS 问题
          signal: controller.signal
        });
      } catch (e) {
        // 如果失败，尝试访问根路径
        response = await fetch(`${route.url}/?_=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          mode: 'no-cors',
          signal: controller.signal
        });
      }

      clearTimeout(timeoutId);

      // no-cors 模式下，response.ok 总是 false，但只要没抛异常就说明可以访问
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);
      
      pingValue.textContent = latency;
      statusIcon.className = 'fas fa-circle';
      routeItem.classList.remove('route-error');
      routeItem.classList.add('route-success');
      
      // 移除之前的延迟类
      routeItem.classList.remove('route-fast', 'route-normal', 'route-slow');
      
      // 根据延迟设置颜色
      if (latency < 200) {
        routeItem.classList.add('route-fast');
      } else if (latency < 500) {
        routeItem.classList.add('route-normal');
      } else {
        routeItem.classList.add('route-slow');
      }
    } catch (error) {
      // 区分超时和其他错误
      if (error.name === 'AbortError') {
        pingValue.textContent = '超时';
      } else {
        pingValue.textContent = '错误';
      }
      statusIcon.className = 'fas fa-circle-xmark';
      routeItem.classList.remove('route-success', 'route-fast', 'route-normal', 'route-slow');
      routeItem.classList.add('route-error');
    }
  },

  /**
   * 绑定事件
   */
  bindEvents() {
    const routeItems = document.querySelectorAll('.route-item');
    routeItems.forEach(item => {
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.switchRoute(item);
      });
    });

    // 标记当前线路
    this.markCurrentRoute();
  },

  /**
   * 标记当前线路
   */
  markCurrentRoute() {
    const currentHost = window.location.host;
    const routeItems = document.querySelectorAll('.route-item');

    routeItems.forEach(item => {
      const routeUrl = item.getAttribute('data-url');
      try {
        const routeHost = new URL(routeUrl).host;
        if (routeHost === currentHost) {
          item.classList.add('route-current');
        }
      } catch (e) {
        console.warn(`[RouteSwitch] 无效的线路 URL: ${routeUrl}`);
      }
    });
  },

  /**
   * 切换线路
   */
  async switchRoute(routeItem) {
    const targetUrl = routeItem.getAttribute('data-url');
    const routeName = routeItem.getAttribute('data-name');

    // 如果是当前线路，不执行跳转
    if (routeItem.classList.contains('route-current')) {
      return;
    }

    // 跳转前即时检测目标线路状态
    routeItem.classList.add('route-loading');
    const isReachable = await this.pingUrl(targetUrl);
    routeItem.classList.remove('route-loading');

    if (!isReachable) {
      if (typeof utils !== 'undefined' && utils.snackbarShow) {
        utils.snackbarShow(`线路 ${routeName} 当前不可用，请稍后再试`);
      }
      return;
    }

    // 保存用户选择
    localStorage.setItem(this.config.storageKey, routeName);

    // 构建目标URL（保持当前路径）
    const currentPath = window.location.pathname + window.location.search + window.location.hash;
    const newUrl = targetUrl + currentPath;

    // 跳转
    window.location.href = newUrl;
  },

  /**
   * 快速 ping 检测目标 URL 是否可达
   */
  async pingUrl(url) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.pingTimeout);
      await fetch(`${url}/ping.txt?_=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 检查当前线路健康状况
   */
  async checkCurrentRouteHealth() {
    const currentItem = document.querySelector('.route-item.route-current');
    if (!currentItem) return;

    const currentRoute = this.routes.find(r => r.name === currentItem.dataset.name);
    if (!currentRoute) return;

    await this.checkRouteLatency(currentRoute);

    if (currentItem.classList.contains('route-error')) {
      // 清除可能无效的偏好
      const preferred = localStorage.getItem(this.config.storageKey);
      if (preferred === currentItem.dataset.name) {
        localStorage.removeItem(this.config.storageKey);
      }
      // 用户提示
      if (typeof utils !== 'undefined' && utils.snackbarShow) {
        utils.snackbarShow('当前线路不可用，请尝试切换到其他线路');
      }
    }
  }
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  RouteSwitch.init();
});

// 支持 PJAX
if (typeof pjax !== 'undefined') {
  document.addEventListener('pjax:complete', () => {
    RouteSwitch.init();
  });
}

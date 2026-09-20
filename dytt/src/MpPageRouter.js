class MpPageRouter {
    constructor(options = {}) {
        // iOS 原生进栈/退栈动画参数（统一常量，方便调手感）
        this.iOS = {
            duration: 380,                                   // 动画时长(ms)，iOS 约 350~420
            curve: 'cubic-bezier(0.32, 0.72, 0, 1)',         // iOS push/pop 缓动
            parallax: 28,                                    // 下层页面横向视差百分比
            dim: 0.12,                                       // 下层页面变暗的最大透明度
            edge: 14,                                        // 边缘滑动手势捕获区宽度(px)，尽量窄以减少对左侧点击的遮挡
            commitRatio: 0.4,                                // 松手提交阈值(已滑过屏宽比例)
            commitVelocity: 0.45                             // 松手提交速度阈值(px/ms)
        };

        this.config = {
            containerId: 'page-container',
            backBtnId: 'backBtn',
            navTitleId: 'navTitle',
            rightBarId: 'rightBar',
            rootPath: './pages/home.html',
            rootTitle: '首页',
            // 新增导航栏默认配置
            navBar: {
                visible: true, // 默认显示导航栏
                backgroundColor: 'rgba(255, 255, 255, 0.8)', // 默认背景色（磨砂白）
                opacity: 1, // 整体透明度
                blur: 10, // 磨砂模糊度
                titleColor: '#000000', // 标题颜色
                backBtnColor: '#007aff', // 返回按钮颜色
                borderVisible: true, // 是否显示底部边框
            },
            loadingTemplate: `
                <div class="page-loading">
                    <div class="loading-spinner"></div>
                    <p class="loading-text">加载中...</p>
                </div>
            `,
            // 新增加载动画配置
            loading: {
                maxShowTime: 3000, // 加载动画最大显示时长(ms)，超时强制隐藏，避免遮罩一直盖住页面导致无法点击
                checkInterval: 50, // 内容检测间隔(ms)
            },
            ...options
        };
        // 合并导航栏配置
        if (options.navBar) {
            this.config.navBar = { ...this.config.navBar, ...options.navBar };
        }
        // 合并加载动画配置
        if (options.loading) {
            this.config.loading = { ...this.config.loading, ...options.loading };
        }

        this.loadingEl = null;
        // 新增：加载动画检测定时器
        this.loadingCheckTimer = null;
        // 新增：加载动画最大时长定时器
        // this.loadingMaxTimer = null;

        this.container = document.getElementById(this.config.containerId);
        this.backBtn = document.getElementById(this.config.backBtnId);
        this.navTitle = document.getElementById(this.config.navTitleId);
        this.rightBar = document.getElementById(this.config.rightBarId);
        // 新增：获取导航栏根元素（需确保页面中有.ios-nav类的元素）
        this.navBarEl = document.querySelector('.ios-nav');
        if (!this.navBarEl) throw new Error('未找到.ios-nav类的导航栏根元素');

        // 新增：标题交叉淡入淡出用的「上一层标题」元素（右滑返回时显示上一页标题）。
        // 复用宿主 .nav-title 的样式（居中、字号等），仅用内联样式控制透明度/位移。
        this.navTitleIn = null;
        if (this.navTitle && this.navBarEl) {
            const inc = document.createElement('div');
            inc.className = 'nav-title nav-title-incoming';
            inc.style.opacity = '0';
            inc.style.pointerEvents = 'none';
            inc.style.willChange = 'transform, opacity';
            inc.style.transform = 'translateX(-50%)';
            inc.textContent = '';
            this.navBarEl.appendChild(inc);
            this.navTitleIn = inc;
            this.navTitle.style.willChange = 'transform, opacity';
        }

        // 说明：左右自定义按钮不再需要「上一层」克隆层——
        // 右滑时只让当前页的左右按钮随距离淡出隐藏，上一页按钮不做淡入。

        this.pageStack = [];
        this.currentPage = null;
        this.isNavigating = false;       // 仅表示「正在加载子页面」，不再用于锁动画
        this._animating = false;         // 动画锁（push/pop/swipe 期间为 true）
        if (!this.container) throw new Error(`容器ID ${this.config.containerId} 不存在`);

        this.injectLoadingStyle();
        // 新增：注入导航栏样式（覆盖默认样式）
        this.injectNavBarStyle();
        // 初始化导航栏样式
        this.initNavBarStyle();
        // 新增：注入页面栈/iframe 基础样式（动画自包含，不再依赖外部 CSS）
        this.injectPageStyle();
        // 新增：初始化交互式边缘滑动返回手势
        this.initSwipeBack();

        this.mountGlobalMethods();
        this.bindEvents();
        this.init();
    }

    // ===================== 动画/层叠样式（自包含，零外部依赖） =====================
    injectPageStyle() {
        const style = document.createElement('style');
        style.textContent = `
            #${this.config.containerId} {
                position: relative !important;
                overflow: hidden !important;            /* 关键：隐藏 off-screen 的页面，避免横向滚动条 */
            }
            .page-wrap {
                position: absolute !important;
                inset: 0 !important;
                display: block !important;
                transform: translate3d(100%, 0, 0);   /* 默认在屏幕右侧外 */
                will-change: transform;
            }
            .page-wrap.initial { transform: translate3d(0, 0, 0) !important; }  /* 根页面不滑动入场 */
            /* 关键：强制覆盖宿主页可能遗留的 .page-iframe { transform: translateX(100%) / display:none } 等规则，
               定位完全交给外层 .page-wrap，iframe 只负责填满。 */
            .page-iframe {
                position: absolute !important;
                inset: 0 !important;
                width: 100% !important;
                height: 100% !important;
                border: 0 !important;
                transform: none !important;
                display: block !important;
                visibility: visible !important;
                opacity: 1 !important;
                /* 关键：原宿主用 .page-iframe.active 才把 pointer-events 翻成 auto；
                   本版改为内联 transform 驱动、不再切 class，故这里强制开启点击，
                   否则 iframe 永远停在宿主默认的 pointer-events:none，整页无法点击。 */
                pointer-events: auto !important;
            }
            .page-dim {
                position: absolute !important;
                inset: 0 !important;
                background: #000;
                opacity: 0;
                pointer-events: none !important;       /* 不拦截任何交互 */
            }
            .page-wrap.ios-shadow {
                box-shadow: -2px 0 12px rgba(0, 0, 0, 0.12) !important;  /* iOS 顶部卡片左侧投影 */
            }
            .ios-edge-swipe {
                position: absolute !important;
                top: 0 !important; left: 0 !important; bottom: 0 !important;
                width: ${this.iOS.edge}px !important;
                z-index: 50 !important;               /* 高于所有页面层，低于导航栏(999) */
                touch-action: none !important;        /* 归我们处理，纵向也不滚动此区 */
            }
        `;
        document.head.appendChild(style);
    }

    // ---- 动画底层工具 ----
    _tx(el, pct) {
        if (el) el.style.transform = `translate3d(${pct}%, 0, 0)`;
    }
    _tr(el, on, dur, curve) {
        if (!el) return;
        dur = (dur == null) ? this.iOS.duration : dur;
        curve = curve || this.iOS.curve;
        el.style.transition = on ? `transform ${dur}ms ${curve}` : 'none';
    }
    _setDim(wrap, opacity, animate) {
        const dim = wrap && wrap.querySelector('.page-dim');
        if (!dim) return;
        dim.style.transition = animate ? `opacity ${this.iOS.duration}ms ${this.iOS.curve}` : 'none';
        dim.style.opacity = String(opacity);
    }
    _setShadow(wrap, on) {
        if (wrap) wrap.classList.toggle('ios-shadow', !!on);
    }
    _createPageWrap(isInitial) {
        const wrap = document.createElement('div');
        wrap.className = 'page-wrap' + (isInitial ? ' initial' : '');
        const iframe = document.createElement('iframe');
        iframe.className = 'page-iframe';
        iframe.src = 'about:blank';
        const dim = document.createElement('div');
        dim.className = 'page-dim';
        wrap.appendChild(iframe);
        wrap.appendChild(dim);
        return wrap;
    }

    // 新增：注入导航栏基础样式
    injectNavBarStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .ios-nav.no-border {
                border-bottom: none !important;
            }
            .ios-nav.no-blur {
                backdrop-filter: none !important;
                -webkit-backdrop-filter: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    // 新增：初始化导航栏样式
    initNavBarStyle() {
        const navConfig = this.config.navBar;
        // 设置基础样式
        this.setNavBarBackgroundColor(navConfig.backgroundColor);
        this.setNavBarOpacity(navConfig.opacity);
        this.setNavBarBlur(navConfig.blur);
        this.setNavBarTitleColor(navConfig.titleColor);
        this.setBackBtnColor(navConfig.backBtnColor);
        this.setNavBarBorder(navConfig.borderVisible);
    }

    // ===================== 新增：加载动画优化核心方法 =====================
    /**
     * 检测iframe是否有可视内容
     * @param {HTMLIFrameElement} iframe - 目标iframe元素
     * @returns {boolean} 是否有可视内容
     */
    checkIframeHasContent(iframe) {
        try {
            if (!iframe.contentWindow || !iframe.contentDocument) return false;

            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const iframeBody = iframeDoc.body;

            if (!iframeBody) return false;

            // 检测条件：满足任一即认为页面已显示内容
            const computedStyle = getComputedStyle(iframeBody);

            // 1. 检测背景色（不是透明/默认值）
            const bgColor = computedStyle.backgroundColor;
            const hasBgColor = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent';

            // 2. 检测body内有子元素
            const hasChildElements = iframeBody.children.length > 0;

            // 3. 检测body高度（不是0）
            const hasHeight = iframeBody.offsetHeight > 0;

            // 4. 检测body内有文本内容
            const hasTextContent = iframeBody.textContent && iframeBody.textContent.trim().length > 0;

            return hasBgColor || hasChildElements || hasHeight || hasTextContent;
        } catch (e) {
            return false;
        }
    }

    /**
     * 隐藏加载动画
     */
    hideLoading() {
        if (this._loadingMaxTimer) {
            clearTimeout(this._loadingMaxTimer);
            this._loadingMaxTimer = null;
        }
        if (this.loadingEl && this.loadingEl.style.display === 'flex') {
            this.loadingEl.style.display = 'none';
        }
    }
    showLoading(){
        if (!this.loadingEl){
            const loadingEl = document.createElement('div');
            loadingEl.className = 'page-loading-wrap';
            this.container.appendChild(loadingEl);
            this.loadingEl = loadingEl;
        }
        if (this.loadingEl.innerHTML !== this.config.loadingTemplate) this.loadingEl.innerHTML = this.config.loadingTemplate;
        if (this.loadingEl.style.display !== 'flex') {
            this.loadingEl.style.display = 'flex';
        }
        // 兜底：超时强制隐藏，防止遮罩一直盖住页面导致整页无法点击
        const max = this.config.loading.maxShowTime;
        if (max > 0) {
            if (this._loadingMaxTimer) clearTimeout(this._loadingMaxTimer);
            this._loadingMaxTimer = setTimeout(() => {
                this.hideLoading();
            }, max);
        }
    }
    /**
     * 检测子页面是否真正就绪（JS 初始化完成）
     * @param {HTMLIFrameElement} iframe - 目标iframe
     * @returns {boolean} 是否就绪
     */
    isChildPageReady(iframe) {
        try {
            // 检测子页面是否已挂载 MpPageLifeCycle（子页面核心对象）
            return !!iframe.contentWindow && !!iframe.contentWindow.MpPageLifeCycle && (iframe.contentWindow.__MpPageLifeCycleInited === true);
        } catch (e) {
            return false;
        }
    }

    /**
     * 等待子页面就绪后执行回调
     * @param {HTMLIFrameElement} iframe - 目标iframe
     * @param {Function} callback - 就绪后执行的回调
     * @param {number} timeout - 最大等待时长（ms），默认10000ms
     */
    waitForChildPageReady(iframe, callback, timeout = 10000) {
        const start = Date.now();
        const checkReady = () => {
            if (this.isChildPageReady(iframe)) {
                callback();
                return;
            }
            setTimeout(checkReady, 50);
        };
        checkReady();
    }
    /**
     * 监控iframe内容显示状态
     * @param {HTMLIFrameElement} iframe - 目标iframe元素
     */
    monitorIframeContent(iframe, callback) {
        if (this.loadingCheckTimer) {
            clearInterval(this.loadingCheckTimer);
            this.loadingCheckTimer = null;
        }

        const loadingConfig = this.config.loading;

        this.loadingCheckTimer = setInterval(() => {
            const hasContent = this.checkIframeHasContent(iframe);
            if (hasContent) {
                this.hideLoading();
                if (typeof callback === 'function') {
                    callback(iframe);
                }
                if (this.loadingCheckTimer) {
                    clearInterval(this.loadingCheckTimer);
                    this.loadingCheckTimer = null;
                }
            }
        }, loadingConfig.checkInterval);
    }

    // ===================== 新增：导航栏控制核心方法 =====================
    /**
     * 设置导航栏标题
     * @param {string} title 标题文本
     * @param {boolean} withAnimation 是否带动画（iOS原生标题切换有淡入淡出）
     */
    setNavTitle(title, withAnimation = true) {
        if (!this.navTitle) return;
        // 清理「上一层标题」，避免交叉淡入淡出残留
        if (this.navTitleIn) {
            this.navTitleIn.style.transition = 'none';
            this.navTitleIn.style.opacity = '0';
            this.navTitleIn.style.transform = 'translateX(-50%)';
            this.navTitleIn.textContent = '';
        }
        if (withAnimation) {
            this.navTitle.style.transition = 'none';
            this.navTitle.style.opacity = '0';
            this.navTitle.style.transform = 'translateX(-50%)';
            setTimeout(() => {
                this.navTitle.textContent = title;
                this.navTitle.style.opacity = '1';
            }, 125);
        } else {
            this.navTitle.textContent = title;
            this.navTitle.style.opacity = '1';
            this.navTitle.style.transform = 'translateX(-50%)';
        }
    }

    // ===================== 导航栏标题交叉淡入淡出（参照 iOS 右滑返回） =====================
    // 当前标题随右滑右移渐隐，上一层标题从左渐入；全部基于「滑动比例 ratio」实时联动。
    // OFFSET：标题在动画中水平位移量(px)，越大越夸张。
    get _titleOffset() { return 42; }

    // 准备「上一层标题」（右滑开始时调用）：写入上一页标题，置于左侧待入。
    _titleSetIncoming(prevTitle) {
        const inc = this.navTitleIn;
        if (!inc) return;
        inc.textContent = prevTitle || '';
        inc.style.transition = 'none';
        inc.style.opacity = '0';
        inc.style.transform = `translateX(calc(-50% - ${this._titleOffset}px))`;
        inc.style.pointerEvents = 'none';
    }

    // 跟手实时更新（右滑 onMove 调用）：ratio 0=完全当前页，1=完全上一页。
    _titleLive(ratio) {
        const cur = this.navTitle, inc = this.navTitleIn;
        if (!cur || !inc) return;
        const off = this._titleOffset;
        const r = Math.max(0, Math.min(1, ratio));
        cur.style.transition = 'none';
        inc.style.transition = 'none';
        cur.style.opacity = String(1 - r);
        cur.style.transform = `translateX(calc(-50% + ${r * off}px))`;
        inc.style.opacity = String(r);
        inc.style.transform = `translateX(calc(-50% + ${(1 - r) * -off}px))`;
    }

    // 收尾（右滑 onUp 或普通 push/pop 调用）：commit=true 落到上一页标题，false 回弹到当前标题。
    _titleFinish(commit) {
        const cur = this.navTitle, inc = this.navTitleIn;
        if (!cur || !inc) return;
        const off = this._titleOffset;
        const dur = this.iOS.duration;
        const tr = `transform ${dur}ms ${this.iOS.curve}, opacity ${dur}ms ${this.iOS.curve}`;
        cur.style.transition = tr;
        inc.style.transition = tr;
        if (commit) {
            cur.style.opacity = '0';
            cur.style.transform = `translateX(calc(-50% + ${off}px))`;
            inc.style.opacity = '1';
            inc.style.transform = 'translateX(-50%)';
        } else {
            cur.style.opacity = '1';
            cur.style.transform = 'translateX(-50%)';
            inc.style.opacity = '0';
            inc.style.transform = `translateX(calc(-50% - ${off}px))`;
        }
        setTimeout(() => {
            if (commit) cur.textContent = inc.textContent;
            cur.style.transition = 'none';
            cur.style.opacity = '1';
            cur.style.transform = 'translateX(-50%)';
            inc.style.opacity = '0';
            inc.style.transition = 'none';
            inc.textContent = '';
        }, dur + 30);
    }

    // 普通 push/pop 时的标题过渡（非手势，按 duration 自动播放一遍交叉淡入淡出）
    _titleCrossfadeTo(newTitle) {
        const cur = this.navTitle, inc = this.navTitleIn;
        if (!cur) { this.setNavTitle(newTitle, false); return; }
        if (!inc) { this.setNavTitle(newTitle, true); return; }
        inc.textContent = newTitle || '';
        inc.style.transition = 'none';
        inc.style.opacity = '0';
        inc.style.transform = `translateX(calc(-50% - ${this._titleOffset}px))`;
        inc.style.pointerEvents = 'none';
        void inc.offsetWidth; // 强制重绘，确保起点生效
        const tr = `transform ${this.iOS.duration}ms ${this.iOS.curve}, opacity ${this.iOS.duration}ms ${this.iOS.curve}`;
        cur.style.transition = tr;
        inc.style.transition = tr;
        requestAnimationFrame(() => {
            cur.style.opacity = '0';
            cur.style.transform = `translateX(calc(-50% + ${this._titleOffset}px))`;
            inc.style.opacity = '1';
            inc.style.transform = 'translateX(-50%)';
        });
        setTimeout(() => {
            cur.textContent = newTitle;
            cur.style.transition = 'none';
            cur.style.opacity = '1';
            cur.style.transform = 'translateX(-50%)';
            inc.style.opacity = '0';
            inc.style.transition = 'none';
            inc.textContent = '';
        }, this.iOS.duration + 30);
    }

    // ===================== 导航栏左右自定义按钮：随右滑距离「显示 → 隐藏」 =====================
    // 右滑返回时，只让【当前页】的左右自定义按钮随滑动距离慢慢淡出隐藏；
    // 不再渲染「上一页」的按钮（已移除上一层克隆层/交叉淡入），上一页按钮在落定后直接呈现。

    // 把当前导航栏左右按钮的真实 DOM 状态记录到某页快照。
    // 在「离开该页」前调用，避免子页后续修改或时序问题导致快照失真。
    _captureBarSnapshot(page) {
        if (!page) return;
        page.rightBarHTML = this.rightBar ? this.rightBar.innerHTML : '';
        page.backBtnHTML = this.backBtn ? this.backBtn.innerHTML : '';
        page.backBtnDisplay = this.backBtn ? this.backBtn.style.display : '';
    }

    // 跟手实时更新（右滑 onMove 调用）：ratio 0=完全显示，1=完全隐藏。
    // 只做透明度渐变：左右自定义按钮随滑动距离慢慢隐藏，不涉及上一页按钮。
    _buttonsLive(ratio) {
        const r = Math.max(0, Math.min(1, ratio));
        [this.backBtn, this.rightBar].forEach((el) => {
            if (!el) return;
            el.style.transition = 'none';
            el.style.opacity = String(1 - r);   // 滑得越远越透明
        });
    }

    // 收尾（右滑 onUp 调用）：
    //   commit=true  落到上一页：按钮继续淡出到隐藏，动画结束后把左右按钮内容换成上一页的并直接显示
    //                （不做淡入，符合「上一页按钮不用显示出来」）
    //   commit=false 回弹到当前页：按钮淡回完全显示
    _buttonsFinish(commit, targetPage) {
        const dur = this.iOS.duration;
        const tr = `opacity ${dur}ms ${this.iOS.curve}`;
        const els = [this.backBtn, this.rightBar].filter(Boolean);
        if (!els.length) return;
        els.forEach((el) => {
            el.style.transition = 'none';
            void el.offsetWidth;                 // 强制重绘，确保下面的过渡生效
            el.style.transition = tr;
            el.style.opacity = commit ? '0' : '1';
        });
        if (!commit) return;
        // 提交：动画结束后换成上一页的按钮内容，并直接恢复显示（不做淡入动画）
        setTimeout(() => {
            if (this.rightBar) {
                this.rightBar.innerHTML = (targetPage && targetPage.rightBarHTML != null) ? targetPage.rightBarHTML : '';
            }
            if (this.backBtn) {
                this.backBtn.innerHTML = (targetPage && targetPage.backBtnHTML != null) ? targetPage.backBtnHTML : '';
                if (targetPage && targetPage.backBtnDisplay) {
                    this.backBtn.style.display = targetPage.backBtnDisplay;
                }
            }
            els.forEach((el) => {
                el.style.transition = 'none';
                el.style.opacity = '1';
            });
        }, dur + 30);
    }

    // 普通 pop（goBack / goHome，非手势）：同样走一遍「淡出 → 换成目标页按钮 → 直接显示」
    _buttonsCrossfadeTo(targetPage) {
        this._buttonsFinish(true, targetPage);
    }

    // 普通导航（push）时按钮整体淡入（仅透明度过渡）
    _buttonsFadeIn() {
        const dur = this.iOS.duration * 0.6;
        const tr = `opacity ${dur}ms ${this.iOS.curve}`;
        [this.backBtn, this.rightBar].forEach((el) => {
            if (!el) return;
            el.style.transition = 'none';
            el.style.opacity = '0';
            void el.offsetWidth;
            el.style.transition = tr;
            el.style.opacity = '1';
        });
    }

    /**
     * 设置导航栏背景
     * @param {string} color 颜色值（支持rgb/rgba/十六进制）
     */
    setNavBarBackgroundColor(color) {
        if (!this.navBarEl) return;
        this.navBarEl.style.backgroundColor = color;
    }

    /**
     * 设置导航栏整体透明度
     * @param {number} opacity 0-1之间的数值
     */
    setNavBarOpacity(opacity) {
        if (!this.navBarEl) return;
        this.navBarEl.style.opacity = Math.max(0, Math.min(1, opacity));
    }

    /**
     * 设置导航栏磨砂模糊度
     * @param {number} blur 模糊像素（0为关闭磨砂）
     */
    setNavBarBlur(blur) {
        if (!this.navBarEl) return;
        if (blur <= 0) {
            this.navBarEl.classList.add('no-blur');
        } else {
            this.navBarEl.classList.remove('no-blur');
            this.navBarEl.style.backdropFilter = `blur(${blur}px)`;
            this.navBarEl.style.webkitBackFilter = `blur(${blur}px)`;
        }
    }

    /**
     * 设置导航栏标题颜色
     * @param {string} color 颜色值
     */
    setNavBarTitleColor(color) {
        if (!this.navTitle) return;
        this.navTitle.style.color = color;
    }

    /**
     * 设置返回按钮颜色
     * @param {string} color 颜色值
     */
    setBackBtnColor(color) {
        if (!this.backBtn) return;
        this.backBtn.style.color = color;
        const backBtnStyle = document.createElement('style');
        backBtnStyle.id = 'back-btn-arrow-style';
        backBtnStyle.textContent = `
            #${this.config.backBtnId}::before {
                border-left-color: ${color};
                border-bottom-color: ${color};
            }
        `;
        const oldStyle = document.getElementById('back-btn-arrow-style');
        if (oldStyle) oldStyle.remove();
        document.head.appendChild(backBtnStyle);
    }

    /**
     * 显示/隐藏导航栏
     * @param {boolean} hidden 是否显示
     */
    setNavBarHidden(hidden) {
        this.navBarEl.style.zIndex = hidden ? 1 : 999;
    }
    /**
     * 显示/隐藏导航栏底部边框
     * @param {boolean} visible 是否显示
     */
    setNavBarBorder(visible) {
        if (!this.navBarEl) return;
        if (visible) {
            this.navBarEl.classList.remove('no-border');
        } else {
            this.navBarEl.classList.add('no-border');
        }
    }

    /**
     * 显示/隐藏返回按钮
     * @param {boolean} visible 是否显示
     */
    setBackBtnVisible(visible) {
        if (!this.backBtn) return;
        this.backBtn.style.display = visible ? 'flex' : 'none';
    }

    safeSetTabBarHidden(hidden) {
        try {
            if (!window.parent) return false;
            if (typeof window.parent.setTabBarHidden !== 'function') return false;
            window.parent.setTabBarHidden(hidden);
            return true;
        } catch (error) {
            console.error('调用setTabBarHidden失败：', error.message);
            return false;
        }
    }
    setTabbarSelectIndex(index) {
        try {
            if (!window.parent) return false;
            if (typeof window.parent.setTabbarSelectIndex !== 'function') return false;
            this.goHome();
            window.parent.setTabbarSelectIndex(index);
            return true;
        } catch (error) {
            console.error('setTabbarSelectIndex', error.message);
            return false;
        }
    }

    setPageBgColor(iframeElement) {
        function setIFrameColor(iframe) {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iframeDoc) {
                console.error("无法访问 iframe 内部文档（可能跨域或 iframe 未加载）");
                return;
            }

            const htmlStyle = getComputedStyle(iframeDoc.documentElement);
            const bodyStyle = getComputedStyle(iframeDoc.body);

            let bgColor = htmlStyle.backgroundColor;
            const isTransparent = (color) => !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)';

            if (isTransparent(bgColor)) {
                bgColor = bodyStyle.backgroundColor;
            }
            if (isTransparent(bgColor)) {
                bgColor = '#ffffff';
            }

            iframe.style.backgroundColor = bgColor;
        }

        try {
            const iframeWin = iframeElement.contentWindow;
            const iframeDoc = iframeElement.contentDocument || iframeWin.document;

            if (iframeDoc.readyState === 'complete' || iframeDoc.readyState === 'interactive') {
                setIFrameColor(iframeElement);
            } else {
                iframeWin.addEventListener('DOMContentLoaded', function () {
                    setIFrameColor(iframeElement);
                });
            }
        } catch (e) {
            console.error("设置 iframe 背景色失败：", e);
        }
    }

    setPageRightBar(html = '') {
        if (html === '' || html === null) {
            this.rightBar.innerHTML = '';
        } else {
            this.rightBar.innerHTML = html;
        }
        // 快照：把当前右侧按钮内容记录到当前页，供右滑/返回时交叉淡入
        if (this.currentPage) this.currentPage.rightBarHTML = this.rightBar.innerHTML;
    }

    setPageLeftBar(html = '') {
        if (html === '' || html === null) {
            this.backBtn.style.setProperty('--back-display', 'inline-block');
            this.backBtn.innerHTML = '';
        } else {
            this.setBackBtnVisible(true);
            this.backBtn.style.setProperty('--back-display', 'none');
            this.backBtn.innerHTML = html;
        }
        // 快照：把当前左侧按钮（返回按钮）内容记录到当前页
        if (this.currentPage) {
            this.currentPage.backBtnHTML = this.backBtn.innerHTML;
            this.currentPage.backBtnDisplay = this.backBtn.style.display;
        }
    }


    // ===================== 原有方法（仅少量调整） =====================
    injectLoadingStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .page-loading-wrap {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: rgba(0,0,0,0.25);
                z-index: 99;
                pointer-events: none;          /* 双保险：即使遮罩因异常未隐藏，也不拦截页面点击 */
            }
            .loading-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top-color: rgba(0, 122, 255, 0.8);
                border-radius: 50%;
                animation: loading-spin 1.2s ease-in-out infinite;
                margin-bottom: 16px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            .loading-text {
                color: rgba(255, 255, 255, 0.9);
                font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
                font-size: 15px;
                font-weight: 400;
                text-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            }
            @keyframes loading-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    mountGlobalMethods() {
        window.pageNavigateTo = (path, title, data = {}) => {
            if (this.isNavigating) return;
            this.navigateTo(path, title, data);
        };
        window.pageGoBack = () => this.goBack();
        window.pageGoHome = () => this.goHome();
        window.pageSetNavTitle = (title, withAnimation = true) => this.setNavTitle(title, withAnimation);
        window.pageSetNavBarBgColor = (color) => this.setNavBarBackgroundColor(color);
        window.pageSetNavBarOpacity = (opacity) => this.setNavBarOpacity(opacity);
        window.pageSetNavBarBlur = (blur) => this.setNavBarBlur(blur);
        window.pageSetNavBarTitleColor = (color) => this.setNavBarTitleColor(color);
        window.pageSetBackBtnColor = (color) => this.setBackBtnColor(color);
        window.pageSetNavBarBorder = (visible) => this.setNavBarBorder(visible);
        window.pageSetBackBtnVisible = (visible) => this.setBackBtnVisible(visible);
        window.pageSetNavBarHidden = (hidden) => this.setNavBarHidden(hidden);
        window.pageSetNavRightBar = (html) => this.setPageRightBar(html);
        window.pageSetNavLeftBar = (html) => this.setPageLeftBar(html);
        window.pageSetTabbarSelectIndex = (index) => this.setTabbarSelectIndex(index);

        window.currentWindow = () => this.currentWindow();
    }

    init() {
        this.navigateTo(this.config.rootPath, this.config.rootTitle, {}, true);
    }

    bindEvents() {
        if (this.backBtn) {
            this.backBtn.addEventListener('click', () => this.goBack());
        }
    }

    // 核心：navigateTo（iOS push 动画）
    navigateTo(path, title, data = {}, isInitial = false) {
        if (this.isNavigating) return;
        this.isNavigating = true;

        const prev = this.currentPage;
        // 离开前先把「即将被覆盖的当前页」按钮真实状态存入快照，
        // 避免子页后续修改 / 时序差异导致快照失真（返回时误判「上一层有按钮」而淡入错误按钮）。
        if (prev) this._captureBarSnapshot(prev);

        // 1. 创建页面包裹层（含 iframe + 变暗遮罩）
        const wrap = this._createPageWrap(isInitial);
        const iframe = wrap.querySelector('iframe');
        iframe.dataset.path = path;
        iframe.dataset.loaded = 'false';

        this.showLoading();
        this.container.appendChild(wrap);
        // 强制重绘
        wrap.getBoundingClientRect();

        const prevWrap = prev ? prev.wrap : null;

        // 0. 进入新页前，先给当前（即将被覆盖）的上一页发送 onHide 生命周期，
        //    保证上一页的页面事件（如暂停、保存状态、埋点）被正确触发。
        if (prev && prev.iframe) {
            this.sendPageMessage(prev.iframe, {
                type: 'onHide',
                data: { to: path, timestamp: Date.now() }
            });
            // 兼容原 class 状态（本版动画在 .page-wrap 上，这里仅供子页面/样式兼容参考）
            prev.iframe.classList.remove('active');
            prev.iframe.classList.add('prev-page');
        }

        if (isInitial) {
            // 根页面：不做滑动入场，直接就位（iOS 首页不滑入）
            this._tx(wrap, 0);
            this._setShadow(wrap, true);
        } else {
            // 2. 设定初始位移
            if (prevWrap) {
                this._tr(prevWrap, false);
                this._tx(prevWrap, 0);
            }
            this._tr(wrap, false);
            this._tx(wrap, 100);
            wrap.getBoundingClientRect(); // 再次重绘，确保起点生效

            // 3. 执行 iOS push：新页从右滑入，旧页左移视差并变暗
            if (prevWrap) {
                this._tr(prevWrap, true);
                this._tx(prevWrap, -this.iOS.parallax);
                this._setDim(prevWrap, this.iOS.dim, true);
            }
            this._tr(wrap, true);
            this._tx(wrap, 0);
            this._setShadow(wrap, true);
        }

        // 4. 记录页面信息
        const pageInfo = { path, iframe, title, data, wrap };
        this.pageStack.push(pageInfo);
        this.currentPage = pageInfo;

        // 5. 更新导航栏（立即执行）
        if (isInitial) {
            this.setNavTitle(title, false);   // 根页面不做过渡
        } else {
            this._titleCrossfadeTo(title);    // 进展时标题交叉淡入淡出
        }
        this.setBackBtnVisible(this.pageStack.length > 1);
        this.safeSetTabBarHidden(this.pageStack.length > 1);
        this._updateEdge();
        this._buttonsFadeIn();                // 进展时按钮淡入

        // 6. 监控 iframe 内容
        this.monitorIframeContent(iframe, () => {
            iframe.dataset.loaded = 'true';
            this.waitForChildPageReady(iframe, () => {
                this.setPageBgColor(iframe);
                this.sendPageMessage(iframe, { type: 'onLoad', data });
                this.sendPageMessage(iframe, {
                    type: 'onShow',
                    data: { ...data, isFirstShow: true, timestamp: Date.now() },
                    stackLength: this.pageStack.length
                });
                this._buttonsFadeIn();        // 子页面已设置右侧/左侧按钮，淡入呈现
            });
            this.isNavigating = false;
        });

        setTimeout(() => {
            iframe.src = path;
            // iframe 文档一加载完就隐藏遮罩（比轮询 body 内容更可靠，避免 JS 延时注入内容的页面被遮罩一直盖住）
            iframe.onload = () => this.hideLoading();
            iframe.onerror = () => {
                this.loadingEl.innerHTML = `
                    <div class="page-loading">
                        <p class="loading-text">载入失败：${path}</p>
                    </div>
                `;
                this.isNavigating = false;
            };
        }, 10);
    }

    // 核心：goBack（iOS pop 动画）
    goBack() {
        if (this.pageStack.length <= 1) return;
        if (this._animating || this.isNavigating) return;
        this._animating = true;

        const leaving = this.currentPage;       // 当前页即将被弹出，记录其按钮真实状态
        if (leaving) this._captureBarSnapshot(leaving);

        const current = this.pageStack.pop();
        const prev = this.pageStack[this.pageStack.length - 1];
        const curWrap = current.wrap;
        const prevWrap = prev ? prev.wrap : null;

        this.hideLoading();

        if (curWrap) {
            this._tr(curWrap, true);
            this._tx(curWrap, 100);
            this._setShadow(curWrap, false);
            this.sendPageMessage(current.iframe, {
                type: 'onHide',
                data: { to: prev && prev.path, isBack: true, timestamp: Date.now() }
            });
            this.sendPageMessage(current.iframe, {
                type: 'onDestroy',
                data: { timestamp: Date.now() }
            });
        }

        if (prevWrap) {
            this._tr(prevWrap, true);
            this._tx(prevWrap, 0);
            this._setDim(prevWrap, 0, true);
        }

        this.currentPage = prev;
        this._titleCrossfadeTo(prev.title);
        this._buttonsCrossfadeTo(prev);       // 返回时当前按钮淡出，落定后换成上一页按钮
        this.setBackBtnVisible(this.pageStack.length > 1);
        this.safeSetTabBarHidden(this.pageStack.length > 1);
        this._updateEdge();
        this.sendPageMessage(prev && prev.iframe, {
            type: 'onShow',
            data: { isBack: true, timestamp: Date.now() },
            stackLength: this.pageStack.length
        });

        setTimeout(() => {
            if (curWrap && this.container.contains(curWrap)) curWrap.remove();
            this._animating = false;
        }, this.iOS.duration + 30);
    }

    // 核心：goHome（回到根，整体滑出）
    goHome() {
        if (this.pageStack.length <= 1) return;
        if (this._animating || this.isNavigating) return;
        this._animating = true;

        const leaving = this.currentPage;       // 当前页即将被弹出，记录其按钮真实状态
        if (leaving) this._captureBarSnapshot(leaving);

        const home = this.pageStack[0];
        const removed = this.pageStack.slice(1);

        // 与 goBack 保持一致：当前可见页在销毁前先收到 onHide，再收到 onDestroy。
        // 顺序很关键——子页面的 onDestroy 会移除 message 监听，所以 onHide 必须先发，否则收不到。
        // （中间层页面在当初被覆盖时已经收过 onHide，这里只需 onDestroy）
        if (leaving) {
            this.sendPageMessage(leaving.iframe, {
                type: 'onHide',
                data: { to: home.path, isBack: true, isHome: true, timestamp: Date.now() }
            });
        }

        removed.forEach((p) => {
            if (p.wrap) {
                this._tr(p.wrap, true);
                this._tx(p.wrap, 100);
                this.sendPageMessage(p.iframe, { type: 'onDestroy', data: { timestamp: Date.now() } });
            }
        });
        if (home.wrap) {
            this._tr(home.wrap, true);
            this._tx(home.wrap, 0);
            this._setDim(home.wrap, 0, true);
        }

        this.pageStack = [home];
        this.currentPage = home;
        this._titleCrossfadeTo(home.title);
        this._buttonsCrossfadeTo(home);        // 回根时当前按钮淡出，落定后换成首页按钮
        this.setBackBtnVisible(false);
        this.safeSetTabBarHidden(false);
        this.sendPageMessage(home.iframe, {
            type: 'onShow',
            data: { isBack: true, isHome: true }
        });
        this.hideLoading();

        setTimeout(() => {
            removed.forEach((p) => {
                if (p.wrap && this.container.contains(p.wrap)) p.wrap.remove();
            });
            this._animating = false;
        }, this.iOS.duration + 30);
    }

    // ===================== 新增：交互式边缘滑动返回手势 =====================
    /**
     * 根据栈深度控制边缘手势层是否拦截事件：
     * - 根页面（栈深=1）时禁用，左侧整条完全可点击，不再有「死区」
     * - 非根页面（可返回）时才启用，用于边缘滑动返回
     */
    _updateEdge() {
        if (!this._edge) return;
        this._edge.style.pointerEvents = this.pageStack.length > 1 ? 'auto' : 'none';
    }

    initSwipeBack() {
        const edge = document.createElement('div');
        edge.className = 'ios-edge-swipe';
        this.container.appendChild(edge);
        this._edge = edge;
        this._updateEdge();   // 初始为根页面，先禁用，避免遮挡首页左侧点击

        let swiping = false;
        let startX = 0, startY = 0, startT = 0;
        let curWrap = null, prevWrap = null;

        const width = () => this.container.clientWidth || window.innerWidth;

        const onDown = (e) => {
            if (this.pageStack.length <= 1 || this._animating || this.isNavigating) return;
            const prev = this.pageStack[this.pageStack.length - 2];
            if (!this.currentPage || !this.currentPage.wrap || !prev || !prev.wrap) return;
            swiping = true;
            startX = e.clientX; startY = e.clientY; startT = Date.now();
            curWrap = this.currentPage.wrap;
            prevWrap = prev.wrap;
            try { edge.setPointerCapture(e.pointerId); } catch (_) {}
            // 滑动过程中关闭过渡，完全跟手
            this._tr(curWrap, false);
            this._tr(prevWrap, false);
            // 准备上一层标题，随右滑渐入（左右按钮不做淡入，只随距离淡出隐藏）
            this._titleSetIncoming(prev.title);
        };

        const onMove = (e) => {
            if (!swiping) return;
            let dx = e.clientX - startX;
            if (dx < 0) dx = 0;                       // 只允许向右滑
            const W = width();
            const p = Math.min(dx, W);
            const ratio = p / W;
            this._tx(curWrap, ratio * 100);                               // 当前页跟着手指右移
            this._tx(prevWrap, -this.iOS.parallax + ratio * this.iOS.parallax); // 下层页回正
            this._setDim(prevWrap, this.iOS.dim * (1 - ratio), false);    // 遮罩实时变淡
            this._titleLive(ratio);                                       // 标题随比例交叉淡入淡出
            this._buttonsLive(ratio);                                   // 左右自定义按钮随滑动距离慢慢隐藏
        };

        const onUp = (e) => {
            if (!swiping) return;
            swiping = false;
            const dx = e.clientX - startX;
            const dt = Math.max(1, Date.now() - startT);
            const W = width();
            const ratio = dx / W;
            const velocity = dx / dt; // px/ms
            const commit = ratio > this.iOS.commitRatio ||
                (velocity > this.iOS.commitVelocity && dx > 30);

            this._animating = true;
            const prevPage = this.pageStack[this.pageStack.length - 2];   // 即将落定的上一页
            if (commit) {
                // 提交：完成 pop
                this._tr(curWrap, true);
                this._tr(prevWrap, true);
                this._tx(curWrap, 100);
                this._tx(prevWrap, 0);
                this._setDim(prevWrap, 0, true);
                this._setShadow(curWrap, false);
                this._titleFinish(true);   // 标题落到上一页
                this._buttonsFinish(true, prevPage);  // 按钮淡出隐藏，落定后换成上一页的按钮
                // 给被弹出的当前页发送 onHide / onDestroy 生命周期（与普通 goBack 一致）
                this.sendPageMessage(this.currentPage.iframe, {
                    type: 'onHide',
                    data: { to: (this.pageStack[this.pageStack.length - 2] || {}).path, isBack: true, timestamp: Date.now() }
                });
                this.sendPageMessage(this.currentPage.iframe, {
                    type: 'onDestroy',
                    data: { timestamp: Date.now() }
                });
                setTimeout(() => {
                    const current = this.pageStack.pop();
                    const prev = this.pageStack[this.pageStack.length - 1];
                    if (current.wrap && this.container.contains(current.wrap)) current.wrap.remove();
                    this.currentPage = prev;
                    this.setBackBtnVisible(this.pageStack.length > 1);
                    this.safeSetTabBarHidden(this.pageStack.length > 1);
                    this._updateEdge();
                    this.sendPageMessage(prev && prev.iframe, {
                        type: 'onShow',
                        data: { isBack: true, timestamp: Date.now() },
                        stackLength: this.pageStack.length
                    });
                    this._animating = false;
                }, this.iOS.duration + 30);
            } else {
                // 回弹：归位
                this._tr(curWrap, true);
                this._tr(prevWrap, true);
                this._tx(curWrap, 0);
                this._tx(prevWrap, -this.iOS.parallax);
                this._setDim(prevWrap, this.iOS.dim, true);
                this._setShadow(curWrap, true);
                this._titleFinish(false);  // 标题回弹到当前页
                this._buttonsFinish(false); // 按钮回弹到当前页
                setTimeout(() => { this._animating = false; }, this.iOS.duration + 30);
            }
        };

        edge.addEventListener('pointerdown', onDown);
        edge.addEventListener('pointermove', onMove);
        edge.addEventListener('pointerup', onUp);
        edge.addEventListener('pointercancel', onUp);
    }

    sendPageMessage(iframe, message) {
        if (!iframe || !iframe.contentWindow || iframe.dataset.loaded !== 'true') return;
        try {
            iframe.contentWindow.postMessage(message, "*");
        } catch (e) {
            console.warn(`生命周期消息发送失败：${e.message}`, message);
        }
    }

    currentWindow() {
        return this.currentPage?.iframe?.contentWindow || window;
    }
}

window.MpPageRouter = MpPageRouter;

// ===================== 扩展子页面控制导航栏的方法 =====================
(function (window) {
    let isDestroyed = false;
    let isLoaded = false;
    let targetOrigin = window.location.origin;
    let handleParentMessage = null;
    let callbacks = {
        onLoad: () => {},
        onShow: () => {},
        onHide: () => {},
        onDestroy: () => {}
    };

    function init(options = {}) {
        if (handleParentMessage) return;
        callbacks = { ...callbacks, ...options };
        const { relaxOriginCheck = true, allowOrigins = [] } = options;
        targetOrigin = window.location.origin;

        handleParentMessage = function (e) {
            if (isDestroyed) return;
            if (!relaxOriginCheck) {
                const isValidOrigin = allowOrigins.length
                    ? allowOrigins.includes(e.origin)
                    : e.origin === targetOrigin;
                if (!isValidOrigin) return;
            }
            const { type, data, stackLength } = e.data || {};
            switch (type) {
                case 'onLoad':
                    if (!isLoaded) {
                        console.log(`-viewDidLoad -path：` + window.location.pathname + window.location.search);
                        isLoaded = true;
                        callbacks.onLoad(data);
                    }
                    break;
                case 'onShow':
                    console.log(`-viewDidAppear -path：` + window.location.pathname + window.location.search);
                    callbacks.onShow(data, stackLength);
                    break;
                case 'onHide':
                    console.log(`-viewDidDisappear -path：` + window.location.pathname + window.location.search);
                    callbacks.onHide(data);
                    break;
                case 'onDestroy':
                    console.log(`-dealloc -path：` + window.location.pathname + window.location.search);
                    isDestroyed = true;
                    callbacks.onDestroy();
                    window.removeEventListener('message', handleParentMessage);
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('message', handleParentMessage);
        window.__MpPageLifeCycleInited = true;
        // ===================== 新增：子页面控制导航栏的方法（直接调用父页面全局方法） =====================
        window.MpSetNavBarBorderVisible = window.parent.pageSetNavBarBorder || (() => console.warn('⚠️ MpSetNavBarBorderVisible 方法未挂载'));
        window.MpSetNavBarOpacity = window.parent.pageSetNavBarOpacity || (() => console.warn('⚠️ MpSetNavBarOpacity 方法未挂载'));
        window.MpSetNavBarBlur = window.parent.pageSetNavBarBlur || (() => console.warn('⚠️ MpSetNavBarBlur 方法未挂载'));
        window.MpSetNavTitle = window.parent.pageSetNavTitle || (() => console.warn('⚠️ MpSetNavTitle 方法未挂载'));
        window.MpSetNavBarBgColor = window.parent.pageSetNavBarBgColor || (() => console.warn('⚠️ MpSetNavBarBgColor 方法未挂载'));
        window.MpSetNavBarTitleColor = window.parent.pageSetNavBarTitleColor || (() => console.warn('⚠️ MpSetNavBarTitleColor 方法未挂载'));
        window.MpSetBackBtnColor = window.parent.pageSetBackBtnColor || (() => console.warn('⚠️ MpSetBackBtnColor 方法未挂载'));
        window.MpSetBackBtnVisible = window.parent.pageSetBackBtnVisible || (() => console.warn('⚠️ MpSetBackBtnHidden 方法未挂载'));
        window.MpSetNavBarHidden = window.parent.pageSetNavBarHidden || (() => console.warn('⚠️ MpSetNavBarHidden 方法未挂载'));
        window.MpSetNavRightBar = window.parent.pageSetNavRightBar || (() => console.warn('⚠️ MpSetNavRightBar 方法未挂载'));
        window.MpSetNavLeftBar = window.parent.pageSetNavLeftBar || (() => console.warn('⚠️ MpSetNavLeftBar 方法未挂载'));
        window.MpNavigateTo = window.parent.pageNavigateTo || (() => console.warn('⚠️ MpNavigateTo 方法未挂载'));
        window.MpBack = window.parent.pageGoBack || (() => console.warn('⚠️ MpBack 方法未挂载'));
        window.MpGoHome = window.parent.pageGoHome || (() => console.warn('⚠️ MpGoHome 方法未挂载'));
        window.MpSetTabbarSelectIndex = window.parent.pageSetTabbarSelectIndex || (() => console.warn('⚠️ MpSetTabbarSelectIndex 方法未挂载'));

    }
    window.MpPageLifeCycle = { init };
})(window);

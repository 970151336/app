/* ============================================================
 * 电影天堂 —— 数据层
 * 主数据源：https://api.yyzy-tv.vip/inc/apijson.php  (苹果CMS JSON API)
 *   ⚠️ 该站被墙，必须经代理转发：
 *      http://129.204.117.172/api/proxy_test?url=<encodeURIComponent(目标URL)>
 *   代理已开启 CORS(Access-Control-Allow-Origin:*) ，浏览器可直连。
 *   接口用法（标准苹果CMS）：
 *     - 列表/分类 : ?ac=list&t=类型ID&pg=页码
 *     - 搜索     : ?ac=search&wd=关键词&pg=页码
 *     - 详情     : ?ac=detail&ids=影片ID   (支持 ids=1,2,3 批量)
 *   注意：list 接口不含 vod_pic / vod_play_url，需再调 detail 补齐海报与分集。
 *   兜底1：cjapi 直连(http://129.204.117.172/miniapp/cjapi，参数用 tid)
 *   兜底2：内置 48 部精编电影库，保证开箱即用。
 * ============================================================ */
(function () {
  'use strict';

  // ---------- 接口配置 ----------
  const PROXY = 'http://129.204.117.172/api/proxy_test';
  const YZYZ = 'https://api.yyzy-tv.vip/inc/apijson.php';
  const CJAPI = 'http://129.204.117.172/miniapp/cjapi';

  // 自定义直连接口（?api= 或 localStorage['movie_api_base']）。设置了就走直连(苹果CMS)，否则走 yyzy+代理。
  const custom = new URLSearchParams(location.search).get('api') || localStorage.getItem('movie_api_base');
  const API = {
    base: custom || CJAPI,
    yyzy: YZYZ,
    proxy: PROXY,
    useYyzy: !custom,           // 默认优先 yyzy+代理
    timeout: 9000
  };
  // 演示模式：只用内置兜底库，不发任何网络请求
  const DEMO = localStorage.getItem('movie_demo') === '1';
  // 强制实时（覆盖演示模式）
  const FORCE_API = localStorage.getItem('movie_force_api') === '1';

  function proxied(target) { return PROXY + '?url=' + encodeURIComponent(target); }
  // 两类数据源的 URL 构造器
  const SRC = {
    yyzy: {
      list: (tid, pg) => proxied(`${YZYZ}?ac=list&t=${tid}&pg=${pg || 1}`),
      detail: (ids) => proxied(`${YZYZ}?ac=detail&ids=${ids}`),
      search: (wd, pg) => proxied(`${YZYZ}?ac=search&wd=${encodeURIComponent(wd)}&pg=${pg || 1}`)
    },
    direct: {
      list: (tid, pg) => `${API.base}?pg=${pg || 1}&tid=${tid}`,
      detail: (ids) => `${API.base}?pg=1&ids=${ids}`,
      search: (wd, pg) => `${API.base}?pg=${pg || 1}&wd=${encodeURIComponent(wd)}`
    }
  };

  // ---------- 分类 TID 清单（用户提供的完整分类树） ----------
  const CATEGORY_TID_LIST = [
    { tid: 5, name: '动作片' }, { tid: 6, name: '喜剧片' }, { tid: 7, name: '爱情片' },
    { tid: 8, name: '科幻片' }, { tid: 9, name: '恐怖片' }, { tid: 10, name: '剧情片' },
    { tid: 11, name: '战争片' }, { tid: 20, name: '记录片' }, { tid: 41, name: '动画片' }, { tid: 61, name: '倫理片' },
    { tid: 12, name: '国产剧' }, { tid: 13, name: '台湾剧' }, { tid: 14, name: '韩国剧' },
    { tid: 15, name: '欧美剧' }, { tid: 16, name: '香港剧' }, { tid: 17, name: '泰国剧' },
    { tid: 18, name: '日本剧' }, { tid: 54, name: '海外剧' },
    { tid: 62, name: '大陆综艺' }, { tid: 63, name: '港台综艺' }, { tid: 64, name: '日韩综艺' }, { tid: 65, name: '欧美综艺' },
    { tid: 66, name: '国产动漫' }, { tid: 67, name: '日韩动漫' }, { tid: 68, name: '欧美动漫' },
    { tid: 69, name: '港台动漫' }, { tid: 70, name: '海外动漫' },
    { tid: 95, name: '漫剧' }, { tid: 96, name: '玄幻' }, { tid: 97, name: '剧情' }, { tid: 98, name: '女性成长' },
    { tid: 99, name: '权谋' }, { tid: 100, name: '豪门' }, { tid: 101, name: '奇幻' }, { tid: 102, name: '宫斗' },
    { tid: 103, name: '脑洞' }, { tid: 104, name: '科幻' }, { tid: 105, name: '冒险' }, { tid: 106, name: '仙侠' },
    { tid: 107, name: '喜剧' }, { tid: 108, name: '动作' }, { tid: 109, name: '悬疑' }, { tid: 110, name: '战神' },
    { tid: 111, name: '刑侦' }, { tid: 112, name: '求生' }, { tid: 113, name: '商战' }, { tid: 114, name: '恐怖' },
    { tid: 115, name: '武侠' }, { tid: 116, name: '爱情' }, { tid: 117, name: 'AI漫剧' }, { tid: 118, name: '擦边剧' },
    { tid: 1, name: '电影' }, { tid: 2, name: '连续剧' }, { tid: 3, name: '动漫' }, { tid: 4, name: '综艺' },
    { tid: 19, name: '福利' }, { tid: 83, name: '短剧大全' }, { tid: 94, name: '体育' }
  ];
  // 分类页分组（顶层菜单 -> 子分类），完整保留用户分类树
  const CATEGORY_GROUPS = [
    { name: '电影', items: [{ tid: 1, name: '全部电影' }, { tid: 5, name: '动作片' }, { tid: 6, name: '喜剧片' }, { tid: 7, name: '爱情片' }, { tid: 8, name: '科幻片' }, { tid: 9, name: '恐怖片' }, { tid: 10, name: '剧情片' }, { tid: 11, name: '战争片' }, { tid: 20, name: '记录片' }, { tid: 41, name: '动画片' }, { tid: 61, name: '倫理片' }] },
    { name: '连续剧', items: [{ tid: 2, name: '全部剧集' }, { tid: 12, name: '国产剧' }, { tid: 13, name: '台湾剧' }, { tid: 14, name: '韩国剧' }, { tid: 15, name: '欧美剧' }, { tid: 16, name: '香港剧' }, { tid: 17, name: '泰国剧' }, { tid: 18, name: '日本剧' }, { tid: 54, name: '海外剧' }] },
    { name: '综艺', items: [{ tid: 4, name: '综艺' }, { tid: 62, name: '大陆综艺' }, { tid: 63, name: '港台综艺' }, { tid: 64, name: '日韩综艺' }, { tid: 65, name: '欧美综艺' }] },
    { name: '动漫', items: [{ tid: 3, name: '动漫' }, { tid: 66, name: '国产动漫' }, { tid: 67, name: '日韩动漫' }, { tid: 68, name: '欧美动漫' }, { tid: 69, name: '港台动漫' }, { tid: 70, name: '海外动漫' }] },
    { name: '短剧大全', items: [{ tid: 83, name: '短剧' }, { tid: 95, name: '漫剧' }, { tid: 96, name: '玄幻' }, { tid: 97, name: '剧情' }, { tid: 98, name: '女性成长' }, { tid: 99, name: '权谋' }, { tid: 100, name: '豪门' }, { tid: 101, name: '奇幻' }, { tid: 102, name: '宫斗' }, { tid: 103, name: '脑洞' }, { tid: 104, name: '科幻' }, { tid: 105, name: '冒险' }, { tid: 106, name: '仙侠' }, { tid: 107, name: '喜剧' }, { tid: 108, name: '动作' }, { tid: 109, name: '悬疑' }, { tid: 110, name: '战神' }, { tid: 111, name: '刑侦' }, { tid: 112, name: '求生' }, { tid: 113, name: '商战' }, { tid: 114, name: '恐怖' }, { tid: 115, name: '武侠' }, { tid: 116, name: '爱情' }, { tid: 117, name: 'AI漫剧' }, { tid: 118, name: '擦边剧' }] },
    { name: '体育 · 福利', items: [{ tid: 94, name: '体育' }, { tid: 19, name: '福利' }] }
  ];
  // 首页「分类直达」网格：取 yyzy 中有数据的 tid（顶层 电影/连续剧/动漫/综艺 返回 0，故用子分类）
  const HOME_TIDS = [
    { tid: 5, name: '动作片', i: 'fa-bolt', c: '#ff6a3d' },
    { tid: 6, name: '喜剧片', i: 'fa-smile-o', c: '#f5a623' },
    { tid: 7, name: '爱情片', i: 'fa-heart', c: '#ff5e8a' },
    { tid: 8, name: '科幻片', i: 'fa-rocket', c: '#5ac8fa' },
    { tid: 12, name: '国产剧', i: 'fa-television', c: '#5ac8fa' },
    { tid: 16, name: '香港剧', i: 'fa-television', c: '#ffb84d' },
    { tid: 14, name: '韩国剧', i: 'fa-television', c: '#ff6a6a' },
    { tid: 20, name: '记录片', i: 'fa-video-camera', c: '#4aa8ff' },
    { tid: 66, name: '动漫', i: 'fa-child', c: '#34c759' },
    { tid: 62, name: '综艺', i: 'fa-music', c: '#ffd24a' }
  ];
  const SEED_TIDS = [5, 10, 12, 16]; // 首页种子分类（动作片/剧情片/国产剧/香港剧，各取一页做实时封面）

  // ---------- 视觉：按 id 生成稳定的渐变色（兜底无海报时使用） ----------
  const PALETTE = [
    ['#ff6a3d', '#b81d24'], ['#7b4397', '#dc2430'], ['#1f4037', '#99f2c8'],
    ['#0f2027', '#2c5364'], ['#41295a', '#2f0743'], ['#c31432', '#240b36'],
    ['#16222a', '#3a6073'], ['#ff512f', '#dd2476'], ['#1a2a6c', '#b21f1f'],
    ['#000428', '#004e92'], ['#603813', '#b29f94'], ['#373b44', '#4286f4'],
    ['#3a1c71', '#d76d77'], ['#11998e', '#38ef7d'], ['#f12711', '#f5af19'],
    ['#232526', '#414345'], ['#cb2d3e', '#ef473a'], ['#654ea3', '#eaafc8']
  ];
  function gradientFor(seed) {
    let h = 0; const s = String(seed);
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const [a, b] = PALETTE[h % PALETTE.length];
    return `linear-gradient(150deg, ${a}, ${b})`;
  }

  // ---------- 解析：苹果CMS 字段 -> 应用电影对象 ----------
  // 老式 vod_play_url： $$$ 分组后 # 片段，片段内 name$url
  function parsePlayGroups(from, url) {
    const froms = (from || '').split('$$$');
    const groups = (url || '').split('$$$');
    const out = [];
    for (let i = 0; i < groups.length; i++) {
      const src = (froms[i] || ('线路' + (i + 1))).trim();
      const multi = froms.length > 1;
      groups[i].split('#').forEach(seg => {
        const k = seg.indexOf('$');
        const name = (k < 0 ? seg.trim() : seg.slice(0, k).trim()) || '线路';
        const u = (k < 0 ? '' : seg.slice(k + 1).trim());
        if (u) out.push({ name: multi ? `${src}·${name}` : name, url: u, src: src });
      });
    }
    return out;
  }
  // vod_play_url 解析：兼容 [{title,url}]（含单引号）、vod_play_from+分集 两种格式
  function parseSources(playFrom, raw) {
    if (!raw && !playFrom) return [];
    if (Array.isArray(raw)) {
      return raw.map(x => ({ name: x.title || x.n || x.name || '线路', url: x.url || x.u || x.play_url || '' })).filter(x => x.url);
    }
    if (typeof raw === 'string') {
      const s = raw.trim();
      if (s[0] === '[') {
        let arr = null;
        try { arr = JSON.parse(s); } catch (e) {}
        if (!arr) { try { arr = (new Function('return ' + s))(); } catch (e) {} } // 兼容单引号
        if (Array.isArray(arr)) {
          return arr.map(x => ({ name: x.title || x.n || x.name || '线路', url: x.url || x.u || x.play_url || '' })).filter(x => x.url);
        }
      }
      return parsePlayGroups(playFrom, s);
    }
    return [];
  }
  function parseVod(v) {
    const cls = (v.vod_class || v.type_name || '').trim();
    const genres = cls.split(/[,/、]/).map(s => s.trim()).filter(Boolean);
    const score = parseFloat(v.vod_score || v.vod_douban_score || '0') || 0;
    return {
      id: v.vod_id,
      title: (v.vod_name || '未命名').replace(/\s+$/, ''),
      pic: v.vod_pic || '',
      year: v.vod_year || '',
      area: v.vod_area || '',
      genre: cls,
      genres: genres,
      score: score,
      remarks: v.vod_remarks || '',
      desc: (v.vod_blurb || v.vod_content || '').replace(/<[^>]+>/g, '').replace(/^\s+/, ''),
      actor: (v.vod_actor || '').replace(/&nbsp;/g, ' '),
      director: (v.vod_director || '').replace(/&nbsp;/g, ' '),
      lang: v.vod_lang || '',
      tid: v.type_id != null ? v.type_id : (v.type_id_1 != null ? v.type_id_1 : ''),
      sources: parseSources(v.vod_play_from, v.vod_play_url),
      playUrl: (typeof v.vod_play_url === 'string') ? v.vod_play_url : '',
      color: gradientFor(v.vod_id),
      coverText: v.vod_name || '影视'
    };
  }

  // ---------- 兜底「精编电影库」（真实影片元数据；播放源用公开测试流演示） ----------
  const TEST_HLS = [
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8'
  ];
  function srcFor(i, n) {
    const arr = [];
    for (let k = 0; k < n; k++) arr.push({ name: ['高清', '蓝光', '备用', '解析'][k] || ('线路' + (k + 1)), url: TEST_HLS[(i + k) % TEST_HLS.length] });
    return arr;
  }
  const RAW = [
    [1,'肖申克的救赎',1994,'美国','剧情 / 犯罪',9.7,'HD','银行家安迪因被冤判谋杀入狱，在肖申克监狱的漫长岁月中，用坚韧与智慧守护希望，最终完成自我救赎。','蒂姆·罗宾斯 / 摩根·弗里曼','弗兰克·德拉邦特','英语'],
    [2,'霸王别姬',1992,'中国','剧情 / 爱情',9.6,'HD','程蝶衣与段小楼半个世纪的悲欢离合，映照时代洪流下戏子与戏、爱与执念的纠缠。','张国荣 / 张丰毅 / 巩俐','陈凯歌','汉语'],
    [3,'阿甘正传',1994,'美国','剧情 / 爱情',9.5,'HD','弱智却纯善的阿甘，用奔跑穿越美国历史，见证了爱情、战争与时代变迁。','汤姆·汉克斯 / 罗宾·怀特','罗伯特·泽米吉斯','英语'],
    [4,'泰坦尼克号',1997,'美国','爱情 / 灾难',9.5,'HD','穷画家杰克与贵族少女露丝在巨轮上相遇相爱，却撞上冰山沉没的宿命。','莱昂纳多 / 凯特·温丝莱特','詹姆斯·卡梅隆','英语'],
    [5,'千与千寻',2001,'日本','动画 / 奇幻',9.4,'HD','少女千寻误入神灵世界，为救父母在汤屋打工，在一段奇异旅程中找回自我。','柊瑠美 / 入野自由','宫崎骏','日语'],
    [6,'这个杀手不太冷',1994,'法国','剧情 / 动作',9.4,'HD','孤独的职业杀手莱昂与邻家少女玛蒂尔达，在血色都市里缔结一段温情羁绊。','让·雷诺 / 娜塔莉·波特曼','吕克·贝松','法语'],
    [7,'美丽人生',1997,'意大利','剧情 / 战争',9.5,'HD','父亲用谎言为儿子编织童话，在集中营的黑暗里守护童真与希望。','罗伯托·贝尼尼','罗伯托·贝尼尼','意大利语'],
    [8,'星际穿越',2014,'美国','科幻 / 冒险',9.4,'HD','地球濒临枯竭，一支探险队穿越虫洞为人类寻找新家园，父女之情跨越时空。','马修·麦康纳 / 安妮·海瑟薇','克里斯托弗·诺兰','英语'],
    [9,'盗梦空间',2010,'美国','科幻 / 悬疑',9.4,'HD','造梦师柯布潜入层层梦境窃取秘密，却陷入真实与虚幻难辨的迷宫。','莱昂纳多 / 渡边谦','克里斯托弗·诺兰','英语'],
    [10,'楚门的世界',1998,'美国','剧情 / 科幻',9.4,'HD','楚门的生活其实是一档全球直播真人秀，他终将识破虚构、走向真实世界。','金·凯瑞','彼得·威尔','英语'],
    [11,'辛德勒的名单',1993,'美国','剧情 / 历史',9.5,'HD','商人辛德勒在二战中倾尽家财，挽救了上千名犹太人的生命。','连姆·尼森','史蒂文·斯皮尔伯格','英语'],
    [12,'忠犬八公的故事',2009,'美国','剧情',9.4,'HD','秋田犬八公日复一日在车站等待逝去的主人，守候成一段感人传说。','理查·基尔','莱塞·霍尔斯道姆','英语'],
    [13,'海上钢琴师',1998,'意大利','剧情 / 音乐',9.3,'HD','生于邮轮的钢琴天才1900，宁愿随船沉没也不踏上陆地，只为守住纯粹的自我。','蒂姆·罗斯','朱塞佩·托纳多雷','意大利语'],
    [14,'三傻大闹宝莱坞',2009,'印度','剧情 / 喜剧',9.2,'HD','三个工科生以叛逆与幽默挑战填鸭教育，追寻真正的热爱与人生。','阿米尔·汗','拉吉库马尔·希拉尼','印地语'],
    [15,'机器人总动员',2008,'美国','动画 / 科幻',9.4,'HD','清扫机器人瓦力在废土地球邂逅探测机器人伊娃，开启一段星际童话。','本·贝尔特','安德鲁·斯坦顿','英语'],
    [16,'放牛班的春天',2004,'法国','剧情 / 音乐',9.3,'HD','代课教师用音乐唤醒一群问题少年，合唱团里响起治愈的歌声。','热拉尔·朱尼奥','克里斯托夫·巴拉蒂','法语'],
    [17,'无间道',2002,'中国','剧情 / 犯罪',9.3,'HD','警方卧底与黑帮内鬼身份错位，在警匪博弈中追问"我想做个好人"。','刘德华 / 梁朝伟','刘伟强 / 麦兆辉','汉语'],
    [18,'大话西游之大圣娶亲',1995,'中国','喜剧 / 爱情',9.2,'HD','至尊宝穿越轮回，在笑泪交织中读懂"曾经有一份真挚的感情"。','周星驰 / 朱茵','刘镇伟','汉语'],
    [19,'疯狂动物城',2016,'美国','动画 / 喜剧',9.2,'HD','兔子警官朱迪与狐狸尼克联手破案，在动物都市揭穿偏见与阴谋。','金妮弗·古德温','拜伦·霍华德','英语'],
    [20,'寻梦环游记',2017,'美国','动画 / 奇幻',9.1,'HD','男孩米格误入亡灵世界，在音乐与记忆中理解亲情与遗忘的真意。','安东尼·冈萨雷斯','李·昂克里奇','英语'],
    [21,'教父',1972,'美国','剧情 / 犯罪',9.3,'HD','柯里昂家族的权力交接，黑帮史诗里写尽忠诚、背叛与父权。','马龙·白兰度 / 阿尔·帕西诺','弗朗西斯·福特·科波拉','英语'],
    [22,'龙猫',1988,'日本','动画 / 奇幻',9.2,'HD','两姐妹乡居遇见森林精灵龙猫，一段温柔治愈的夏日奇遇。','日高法子','宫崎骏','日语'],
    [23,'控方证人',1957,'美国','剧情 / 悬疑',9.6,'HD','庭审剧巅峰，律师为谋杀嫌犯辩护，结局三重反转令人叫绝。','泰隆·鲍华','比利·怀尔德','英语'],
    [24,'天堂电影院',1988,'意大利','剧情 / 爱情',9.2,'HD','放映师与少年托托的忘年交，电影与乡愁在胶片里缓缓流淌。','菲利普·努瓦雷','朱塞佩·托纳多雷','意大利语'],
    [25,'当幸福来敲门',2006,'美国','剧情',9.2,'HD','破产单亲父亲带着儿子推销骨密度仪，在绝境中拼出逆袭人生。','威尔·史密斯','加布里埃莱·穆奇诺','英语'],
    [26,'搏击俱乐部',1999,'美国','剧情 / 悬疑',9.0,'HD','失眠白领与肥皂商组建地下搏击俱乐部，却走向失控的身份分裂。','布拉德·皮特 / 爱德华·诺顿','大卫·芬奇','英语'],
    [27,'两杆大烟枪',1998,'英国','剧情 / 喜剧',9.1,'HD','四个小子设局捞钱，却牵出一团黑色幽默的连环骗局。','杰森·弗莱明','盖·里奇','英语'],
    [28,'看不见的客人',2016,'西班牙','悬疑 / 惊悚',8.8,'HD','企业家与金牌律师在密室命案中反复推演，真相层层反转。','马里奥·卡萨斯','奥里奥尔·保罗','西班牙语'],
    [29,'七宗罪',1995,'美国','犯罪 / 悬疑',8.8,'HD','连环杀手按七宗罪连下杀招，新老警探在绝望中追凶。','布拉德·皮特 / 摩根·弗里曼','大卫·芬奇','英语'],
    [30,'致命魔术',2006,'美国','悬疑 / 惊悚',8.9,'HD','两位魔术师为超越彼此不择手段，以一生代价换取舞台奇迹。','休·杰克曼 / 克里斯蒂安·贝尔','克里斯托弗·诺兰','英语'],
    [31,'英雄本色',1986,'中国','动作 / 犯罪',8.9,'HD','江湖兄弟情义与背叛，小马哥的风衣墨镜成为银幕经典。','周润发 / 狄龙 / 张国荣','吴宇森','汉语'],
    [32,'低俗小说',1994,'美国','犯罪 / 剧情',8.9,'HD','非线性叙事串起杀手、拳手与黑帮老大的荒诞暴力寓言。','约翰·特拉沃尔塔','昆汀·塔伦蒂诺','英语'],
    [33,'疯狂的石头',2006,'中国','喜剧 / 犯罪',8.9,'HD','重庆笨贼与各路人马围绕一块翡翠连环相撞，黑色喜剧笑料百出。','郭涛 / 黄渤','宁浩','汉语'],
    [34,'让子弹飞',2010,'中国','剧情 / 喜剧',9.0,'HD','县长、恶霸与义士在鹅城斗法，台词犀利、隐喻深远。','姜文 / 葛优 / 周润发','姜文','汉语'],
    [35,'大闹天宫',1961,'中国','动画 / 神话',9.0,'HD','美猴王孙悟空大闹天庭，国产动画的巅峰之作。','邱岳峰','万籁鸣','汉语'],
    [36,'哪吒闹海',1979,'中国','动画 / 神话',8.9,'HD','少年哪吒削骨还父、削肉还母，反抗天命的国产动画经典。','梁正晖','王树忱','汉语'],
    [37,'黑客帝国',1999,'美国','科幻 / 动作',9.1,'HD','程序员尼奥觉醒，发现世界是矩阵幻象，成为对抗机器的"救世主"。','基努·里维斯','沃卓斯基','英语'],
    [38,'指环王3：王者无敌',2003,'美国','奇幻 / 冒险',9.3,'HD','魔戒远征队迎来终章，中土世界为自由与希望决一死战。','伊利亚·伍德','彼得·杰克逊','英语'],
    [39,'阿凡达',2009,'美国','科幻 / 冒险',8.8,'HD','人类潜入潘多拉星球，与纳威人共谱一场蓝色星球上的战争与爱。','萨姆·沃辛顿','詹姆斯·卡梅隆','英语'],
    [40,'复仇者联盟4：终局之战',2019,'美国','科幻 / 动作',8.6,'HD','幸存的英雄穿越时空收集宝石，与灭霸展开终极一战。','小罗伯特·唐尼','罗素兄弟','英语'],
    [41,'疯狂的麦克斯4',2015,'澳大利亚','动作 / 科幻',8.7,'HD','废土飞车狂飙，芙莉奥莎带五名妻子逃离暴君，公路史诗燃爆。','汤姆·哈迪','乔治·米勒','英语'],
    [42,'寄生虫',2019,'韩国','剧情 / 悬疑',8.8,'HD','穷人一家渗入富豪家庭，阶级裂缝在血腥中轰然崩开。','宋康昊','奉俊昊','韩语'],
    [43,'素媛',2013,'韩国','剧情',9.0,'HD','小女孩遭遇侵害后，家人用爱陪她走出阴霾，催泪现实题材。','薛景求','李濬益','韩语'],
    [44,'情书',1995,'日本','剧情 / 爱情',8.9,'HD','一封寄往天国的信，牵出两段错位的暗恋与青春遗憾。','中山美穗','岩井俊二','日语'],
    [45,'海上花',1998,'中国','剧情',8.6,'HD','清末上海长三书寓里，男人与名妓们周旋的浮世悲欢。','梁朝伟 / 羽田美智子','侯孝贤','汉语'],
    [46,'降临',2016,'美国','科幻 / 悬疑',7.8,'HD','语言学家与外星生物沟通，在非线性时间中读懂"一生"的含义。','艾米·亚当斯','丹尼斯·维伦纽瓦','英语'],
    [47,'银翼杀手2049',2017,'美国','科幻 / 悬疑',8.4,'HD','复制人K追查秘密，在灰冷未来里追问何为"人"。','瑞恩·高斯林','丹尼斯·维伦纽瓦','英语'],
    [48,'小偷家族',2018,'日本','剧情',8.7,'HD','靠偷窃为生的底层之家，用偷来的温情彼此取暖，却难逃现实的裂痕。','中川雅也','是枝裕和','日语']
  ];
  function buildFallback() {
    return RAW.map((r, i) => {
      const genres = r[4].split('/').map(s => s.trim());
      return {
        id: r[0], title: r[1], year: r[2], area: r[3], genre: r[4], genres: genres,
        score: r[5], remarks: r[6], desc: r[7], actor: r[8], director: r[9], lang: r[10],
        pic: '', sources: srcFor(i, 3), playUrl: '',
        color: gradientFor(r[0]), coverText: r[1]
      };
    });
  }

  // ---------- 网络请求（带超时 + 重试退避，应对代理偶发限流） ----------
  async function getJSON(url, tries) {
    tries = tries || 3;
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), API.timeout);
      try {
        const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
      } catch (e) { lastErr = e; if (i < tries - 1) await new Promise(r => setTimeout(r, 350 * (i + 1))); }
      finally { clearTimeout(t); }
    }
    throw lastErr;
  }

  // ---------- 数据就绪机制（事件总线：初始 + 每次升级都会回调） ----------
  let _ready = false;
  const _cbs = [];
  function notify() { _ready = true; _cbs.slice().forEach(cb => { try { cb(window.MOVIES); } catch (e) {} }); }
  function whenMoviesReady(cb) { if (_ready && window.MOVIES) { try { cb(window.MOVIES); } catch (e) {} } _cbs.push(cb); }

  // 去重（按 id，保留首次出现顺序）
  function dedupe(items) {
    const seen = {}, out = [];
    items.forEach(x => { if (x && x.id != null && !seen[String(x.id)]) { seen[String(x.id)] = 1; out.push(x); } });
    return out;
  }
  // 合并去重（按 id，追加进 window.MOVIES）
  function mergeInto(items) {
    window.MOVIES = dedupe((window.MOVIES || []).concat(items));
  }

  // 取列表（yyzy 优先，失败回退直连 cjapi）
  async function fetchListRaw(tid, pg) {
    if (API.useYyzy) {
      try { const d = await getJSON(SRC.yyzy.list(tid, pg)); if (d && d.list) return { d: d, via: 'yyzy' }; } catch (e) {}
    }
    const d = await getJSON(SRC.direct.list(tid, pg));
    return { d: d, via: 'direct' };
  }
  // 用 detail 批量补齐海报/分集（仅 yyzy 列表缺图时需要）。按每页 20 个 id 分批，避免超大请求被代理限流
  async function enrichWithDetails(items) {
    if (!API.useYyzy || !items.length) return items;
    const CHUNK = 20;
    const mp = {};
    for (let i = 0; i < items.length; i += CHUNK) {
      const slice = items.slice(i, i + CHUNK);
      const ids = slice.map(x => x.id).join(',');
      try {
        const d = await getJSON(SRC.yyzy.detail(ids));
        (d.list || []).forEach(v => { const p = parseVod(v); mp[String(p.id)] = p; });
      } catch (e) { /* 该批失败跳过，保留列表无海报项 */ }
    }
    if (!Object.keys(mp).length) return items;
    return items.map(x => {
      const p = mp[String(x.id)];
      if (!p) return x;
      return Object.assign({}, x, {
        pic: p.pic || x.pic,
        sources: p.sources.length ? p.sources : x.sources,
        playUrl: p.playUrl || x.playUrl, desc: p.desc || x.desc, actor: p.actor || x.actor,
        director: p.director || x.director, remarks: p.remarks || x.remarks, year: p.year || x.year,
        area: p.area || x.area, lang: p.lang || x.lang, score: p.score || x.score
      });
    });
  }

  // ---------- 加载：兜底即时渲染，后台拉取实时接口并升级 ----------
  const LIVE_CACHE_KEY = 'movie_live_cache_v2';
  const LIVE_TTL = 10 * 60 * 1000; // 10 分钟
  function cacheLive(list) {
    try { localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ t: Date.now(), list: list })); } catch (e) {}
  }
  function readLiveCache() {
    try {
      const o = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY));
      if (o && o.list && (Date.now() - (o.t || 0) < LIVE_TTL)) return o.list;
    } catch (e) {}
    return null;
  }
  function loadMovies() {
    // 1) 兜底即时渲染，永不阻塞
    window.MOVIES = buildFallback();
    window.__MOVIES_LIVE = false;
    notify();

    if (DEMO && !FORCE_API) { window.__MOVIES_LIVE = false; return; }

    // 2) 命中本地实时缓存则直接用（跨页面共享，省去重复请求）
    const cached = readLiveCache();
    if (cached && cached.length) {
      window.MOVIES = cached; window.__MOVIES_LIVE = true; notify(); return;
    }
    // 3) 后台并行拉取种子分类，每页单独批量 detail 补齐海报/分集，成功则合并去重并升级
    (async () => {
      try {
        const results = await Promise.all(SEED_TIDS.map(async (tid) => {
          try {
            const r = await fetchListRaw(tid, 1);
            let items = (r.d && r.d.list || []).map(parseVod);
            if (r.via === 'yyzy') items = await enrichWithDetails(items); // 每页 20 条，批量详情可靠
            return items;
          } catch (e) { return []; }
        }));
        let merged = [];
        results.forEach(list => list.forEach(v => { if (v && v.id != null) merged.push(v); }));
        merged = dedupe(merged);
        if (merged.length) {
          window.MOVIES = merged;
          window.__MOVIES_LIVE = true;
          cacheLive(window.MOVIES);
          notify();
        }
      } catch (e) { /* 保持兜底库 */ }
    })();
  }

  // ---------- 实时辅助 ----------
  async function fetchByTid(tid, pg) {
    try {
      const r = await fetchListRaw(tid, pg || 1);
      let items = (r.d && r.d.list || []).map(parseVod);
      if (r.via === 'yyzy') items = await enrichWithDetails(items); // 补齐海报与分集
      mergeInto(items); // 并入全局，保证详情/播放可命中
      return { items, total: Number(r.d.total || 0), pagecount: Number(r.d.pagecount || 1), page: Number(r.d.page || (pg || 1)) };
    } catch (e) { return { items: [], total: 0, pagecount: 1, page: 1 }; }
  }
  async function fetchDetail(ids) {
    const src = API.useYyzy ? SRC.yyzy : SRC.direct;
    try {
      const d = await getJSON(src.detail(ids));
      const list = (d && d.list) || [];
      const p = list[0] ? parseVod(list[0]) : null;
      if (p) mergeInto([p]); // 并入全局，保证详情/播放页可命中
      return p;
    } catch (e) { return null; }
  }
  async function fetchSearch(wd, pg) {
    const src = API.useYyzy ? SRC.yyzy : SRC.direct;
    try {
      const d = await getJSON(src.search(wd, pg || 1));
      let items = ((d && d.list) || []).map(parseVod);
      if (API.useYyzy) items = await enrichWithDetails(items);
      return items;
    } catch (e) { return []; }
  }

  // ---------- 列表 / 搜索 / 排行 辅助（基于 window.MOVIES） ----------
  function getMovieById(id) {
    const D = window.MOVIES || [];
    return D.find(x => String(x.id) === String(id)) || null;
  }
  function byClass(cls) {
    const D = window.MOVIES || [];
    if (!cls || cls === 'all') return D.slice();
    return D.filter(x => (x.genres || []).some(g => g.indexOf(cls) >= 0) || (x.genre || '').indexOf(cls) >= 0);
  }
  function byArea(area) {
    const D = window.MOVIES || [];
    if (!area || area === 'all') return D.slice();
    return D.filter(x => (x.area || '').indexOf(area) >= 0);
  }
  function byYear(y) {
    const D = window.MOVIES || [];
    if (!y || y === 'all') return D.slice();
    return D.filter(x => String(x.year) === String(y));
  }
  function searchLocal(wd) {
    const D = window.MOVIES || [];
    const k = (wd || '').trim().toLowerCase();
    if (!k) return [];
    return D.filter(x => (x.title + x.actor + x.director + x.genre).toLowerCase().indexOf(k) >= 0);
  }
  function rankBy(kind) {
    const D = (window.MOVIES || []).slice();
    if (kind === 'new') D.sort((a, b) => String(b.year).localeCompare(String(a.year)));
    else if (kind === 'classic') {
      const old = D.filter(x => Number(x.year) <= 2010);
      (old.length ? old : D).sort((a, b) => b.score - a.score);
      return (old.length ? old : D);
    }
    else D.sort((a, b) => b.score - a.score); // hot / top 默认按分
    return D;
  }
  function sections() {
    const D = window.MOVIES || [];
    const uniq = (arr, n) => dedupe(arr).slice(0, n);
    const byScore = D.slice().sort((a, b) => b.score - a.score);
    const newest = D.slice().sort((a, b) => String(b.year).localeCompare(String(a.year)));
    const cn = D.filter(x => /中国|大陆|香港|台湾|华语/.test(x.area));
    const hasPic = D.filter(x => x.pic);
    return [
      { title: '热门推荐', sub: '高人气精选', list: uniq(hasPic.length >= 4 ? hasPic : D.slice(), 10) },
      { title: '最新上线', sub: '近期佳作', list: uniq(newest, 10) },
      { title: '华语影视', sub: '国产好片', list: uniq(cn, 10) },
      { title: '高分精选', sub: '影迷必看', list: uniq(byScore, 10) }
    ];
  }
  function recommendOf(m, n) {
    const D = window.MOVIES || [];
    const gs = m.genres || [];
    return D.filter(x => x.id !== m.id && gs.some(g => (x.genres || []).indexOf(g) >= 0)).slice(0, n || 6);
  }
  // 首屏轮播：优选用有海报的影片
  function featured() {
    const D = window.MOVIES || [];
    const withPic = D.filter(x => x.pic);
    return (withPic.length >= 4 ? withPic : D).slice(0, 4);
  }

  // ---------- UI 组件：海报 + 懒加载 ----------
  let _io = null;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function loadImg(el) { const s = el.dataset.src; if (s) { el.src = s; el.removeAttribute('data-src'); } }
  const MpUI = {
    posterHTML(d, opts) {
      opts = opts || {};
      const inner = d.pic
        ? `<img class="cover-img lazy" data-src="${esc(d.pic)}" alt="${esc(d.title)}" referrerpolicy="no-referrer" loading="lazy">`
        : `<div class="cover-fill" style="background:${d.color}">${d.coverText}</div>`;
      const badge = opts.badge ? `<div class="badge">${esc(opts.badge)}</div>` : '';
      const score = (d.score && Number(d.score) > 0) ? `<div class="score">${d.score}</div>` : '';
      const cap = opts.cap !== false ? `<div class="cap">${esc(d.title)}</div>` : '';
      const meta = opts.meta !== false ? `<div class="meta">${[d.year, d.area, d.remarks].filter(Boolean).map(esc).join(' · ')}</div>` : '';
      return `<div class="poster" onclick="openDetail(${JSON.stringify(String(d.id)).replace(/^"|"$/g, "'")})">
        <div class="cover">${inner}${score}${badge}</div>${cap}${meta}</div>`;
    },
    lazyScan(root) {
      root = root || document;
      const els = root.querySelectorAll('img.lazy[data-src]');
      if (!els.length) return;
      if (!('IntersectionObserver' in window)) { els.forEach(loadImg); return; }
      if (!_io) _io = new IntersectionObserver(entries => {
        entries.forEach(en => { if (en.isIntersecting) { loadImg(en.target); _io.unobserve(en.target); } });
      });
      els.forEach(el => _io.observe(el));
    }
  };

  // ---------- 导出 ----------
  window.MOVIES = [];
  window.getMovieById = getMovieById;
  window.movieSections = sections;
  window.movieByClass = byClass;
  window.movieByArea = byArea;
  window.movieByYear = byYear;
  window.movieSearch = searchLocal;
  window.movieRank = rankBy;
  window.movieRecommend = recommendOf;
  window.movieFeatured = featured;
  window.whenMoviesReady = whenMoviesReady;
  window.CATEGORY_TID_LIST = CATEGORY_TID_LIST;
  window.CATEGORY_GROUPS = CATEGORY_GROUPS;
  window.HOME_TIDS = HOME_TIDS;
  window.movieByTid = fetchByTid;
  window.MovieAPI = {
    load: function () { loadMovies(); return Promise.resolve(); },
    fetchDetail, fetchSearch, fetchByType: fetchByTid,
    base: API.useYyzy ? (PROXY + '?url=' + encodeURIComponent(YZYZ)) : API.base,
    source: API.useYyzy ? 'yyzy-proxy' : 'direct'
  };
  window.MpUI = MpUI;

  // 全局详情跳转：posterHTML 的 onclick 依赖它，必须保证每个渲染海报的页面都可用
  // （首页原在自身脚本里定义，但详情/分类/排行/搜索等页也用 posterHTML，故上提到这里）
  window.openDetail = function (id) {
    try { MpNavigateTo('./pages/detail.html', '', { id: String(id) }); } catch (e) {}
  };

  // 启动加载（兜底即时，实时后台升级）
  loadMovies();
})();

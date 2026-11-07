// 部门工作台 · 应用逻辑
// 云服务配置来自 activate 返回的 publicConfig（前端可安全携带）

const PUBLIC_CONFIG = {
  endpoint: "https://dept-workspace-27153.app.workbuddy.host",
  oauthRelayBaseUrl: "https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey: "wbpk_Pbzwea2gOhMuGtuUFOXDLn_TWi3GnuJpUfMniGxW2gI4ncmv9WZcoZE",
};

// ===== 云服务客户端 =====
let cloud = null;
function initCloud() {
  if (typeof WorkBuddyCloud === "undefined") {
    setServiceStatus(false, "SDK 加载失败");
    return false;
  }
  try {
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
      publishableKey: PUBLIC_CONFIG.publishableKey,
    });
    setServiceStatus(true, "服务已连接");
    return true;
  } catch (e) {
    setServiceStatus(false, "初始化失败");
    return false;
  }
}

// ===== 视图导航 =====
const VIEW_NAMES = {
  overview: "概览",
  reminders: "活动提醒",
  templates: "公文模板",
  scores: "加减分",
  guide: "使用指南",
  profile: "我的",
};

function switchView(view) {
  document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
  const target = document.getElementById("view-" + view);
  if (target) target.hidden = false;
  document.querySelectorAll(".nav-item[data-view]").forEach((n) => {
    n.classList.toggle("active", n.dataset.view === view);
  });
  document.getElementById("page-name").textContent = VIEW_NAMES[view] || view;
  // 移动端收起侧栏
  document.body.classList.remove("sidebar-open");
  // 切到公文模板页时刷新数据
  if (view === "templates") {
    loadTemplates();
    loadTemplateOptions();
  }
  // 切到活动提醒页时刷新数据
  if (view === "reminders") {
    loadActivities();
    checkReminderPermission();
  }
  // 切到加减分页时刷新数据
  if (view === "scores") {
    checkScorePermission().then(() => loadScores());
    loadMemberOptions();
    loadMemberList();
    loadAdminList();
  }
  // 切到我的页时刷新资料
  if (view === "profile") {
    renderProfile();
  }
  // 视图切换后重新测量橡皮筋分段选择器（页面从 hidden 变为可见）
  requestAnimationFrame(() => {
    if (typeof remeasureRubberSegments === "function") remeasureRubberSegments();
  });
}

// ===== 侧栏收起 =====
document.getElementById("toggle-sidebar").addEventListener("click", () => {
  if (window.innerWidth <= 760) {
    document.body.classList.toggle("sidebar-open");
  } else {
    document.body.classList.toggle("sidebar-collapsed");
  }
});
document.getElementById("sidebar-backdrop").addEventListener("click", () => {
  document.body.classList.remove("sidebar-open");
});

// ===== 导航绑定 =====
document.querySelectorAll(".nav-item[data-view], .button[data-view], .visual-card[data-view]").forEach((el) => {
  el.addEventListener("click", () => switchView(el.dataset.view));
});

// ===== 服务状态 =====
function setServiceStatus(ok, text) {
  const dot = document.querySelector(".status-dot");
  const statusEl = document.getElementById("service-status");
  if (dot) dot.classList.toggle("offline", !ok);
  if (statusEl) statusEl.textContent = text;
}

// ===== 登录逻辑 =====
const authDialog = document.getElementById("auth-dialog");
const authTab = "phone"; // 当前登录方式：phone | email
let pendingOtp = null; // { phone|email, verificationId, isExistingUser }
let countdownTimer = null;

const loginBtn = document.getElementById("login-btn");
const topAvatar = document.getElementById("top-avatar");

loginBtn.addEventListener("click", () => openAuthDialog());
document.getElementById("auth-close").addEventListener("click", () => authDialog.close());

// 点击侧栏用户区 / 顶部头像 → 切换到「我的」页面
const workspaceUser = document.querySelector(".workspace-user");
if (workspaceUser) workspaceUser.addEventListener("click", () => switchView("profile"));
topAvatar.addEventListener("click", () => switchView("profile"));

function openAuthDialog() {
  authDialog.showModal();
}

// 登录方式切换
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.tab;
    const input = document.getElementById("auth-input");
    const label = document.getElementById("auth-field-label");
    if (mode === "phone") {
      input.placeholder = "请输入手机号";
      label.textContent = "手机号";
      input.value = "";
    } else {
      input.placeholder = "请输入邮箱";
      label.textContent = "邮箱";
      input.value = "";
    }
    document.getElementById("auth-error").textContent = "";
    document.getElementById("auth-code").value = "";
    pendingOtp = null;
  });
});

function currentMode() {
  return document.querySelector(".auth-tab.active").dataset.tab;
}

function showAuthError(msg) {
  document.getElementById("auth-error").textContent = msg || "";
}

// 获取验证码
document.getElementById("auth-send").addEventListener("click", async () => {
  if (!cloud) { showAuthError("服务未连接，请刷新重试"); return; }
  const mode = currentMode();
  const val = document.getElementById("auth-input").value.trim();
  showAuthError("");

  if (mode === "phone") {
    if (!/^1\d{10}$/.test(val)) { showAuthError("请输入正确的 11 位手机号"); return; }
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { showAuthError("请输入正确的邮箱地址"); return; }
  }

  const sendBtn = document.getElementById("auth-send");
  sendBtn.disabled = true;

  const sent = await cloud.auth.sendOtp(mode === "phone" ? { phone: val } : { email: val });
  if (sent.error) {
    showAuthError(sent.error.message || "验证码发送失败");
    sendBtn.disabled = false;
    return;
  }
  pendingOtp = {
    [mode]: val,
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  };
  startCountdown(sendBtn);
});

function startCountdown(btn) {
  let n = 60;
  btn.textContent = `${n}s`;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(countdownTimer);
      btn.textContent = "获取验证码";
      btn.disabled = false;
    } else {
      btn.textContent = `${n}s`;
    }
  }, 1000);
}

// 登录/注册
document.getElementById("auth-submit").addEventListener("click", async () => {
  if (!cloud) { showAuthError("服务未连接"); return; }
  const mode = currentMode();
  const val = document.getElementById("auth-input").value.trim();
  const code = document.getElementById("auth-code").value.trim();
  showAuthError("");

  if (!pendingOtp || pendingOtp[mode] !== val) {
    showAuthError("请先获取验证码");
    return;
  }
  if (!code) { showAuthError("请输入验证码"); return; }

  const completed = await cloud.auth.verifyOtp({
    [mode]: pendingOtp[mode],
    verificationId: pendingOtp.verificationId,
    isExistingUser: pendingOtp.isExistingUser,
    token: code,
  });
  if (completed.error) {
    showAuthError(completed.error.message || "验证失败");
    return;
  }
  pendingOtp = null;
  authDialog.close();
  await refreshUser();
});

// WorkBuddy 登录
document.getElementById("auth-workbuddy").addEventListener("click", async () => {
  if (!cloud) { showAuthError("服务未连接"); return; }
  showAuthError("");
  const back = new URL(location.href);
  back.pathname = "/";
  for (const key of ["code", "state", "provider"]) back.searchParams.delete(key);
  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: "workbuddy",
    redirectTo: back.toString(),
  });
  if (error) {
    showAuthError(error.message || "登录失败");
    return;
  }
  location.assign(data.url);
});

// ===== 会话恢复与用户信息 =====
// 当前登录用户的完整信息缓存（含自定义昵称/头像）
let currentUserInfo = null;

async function refreshUser() {
  if (!cloud) return;
  const { data: session, error } = await cloud.auth.getSession();
  const nameEl = document.getElementById("user-name");
  const avatarEls = [document.getElementById("user-avatar"), document.getElementById("top-avatar")];

  if (error || !session) {
    currentUserInfo = null;
    nameEl.textContent = "未登录";
    avatarEls.forEach((a) => (a.textContent = "访"));
    // 未登录：只显示胶囊登录按钮，隐藏头像
    if (loginBtn) loginBtn.hidden = false;
    if (topAvatar) topAvatar.hidden = true;
    return;
  }

  const user = session.user || {};
  let name = user.name || "";
  let phone = user.phone || "";
  let email = user.email || "";
  let avatarUrl = user.avatarUrl || "";
  let uid = user.id || user.sub || "";
  // OTP 登录时 session.user 无 name/phone，需用 getUser() 获取
  try {
    const u = await cloud.auth.getUser();
    name = name || u.data?.name || "";
    phone = phone || u.data?.phone || "";
    email = email || u.data?.email || "";
    avatarUrl = avatarUrl || u.data?.avatarUrl || "";
    uid = uid || u.data?.id || u.data?.sub || "";
  } catch (e) {
    // 忽略，使用 session 内已有字段
  }

  // 读取自定义资料（昵称/头像），优先展示用户自己设置的
  let custom = { name: "", avatarUrl: "" };
  if (uid && cloud.database) {
    try {
      const { data } = await cloud.database.from("profiles").select("name, avatar_url").eq("uid", uid).maybeSingle();
      if (data) custom = { name: data.name || "", avatarUrl: data.avatar_url || "" };
    } catch (e) {
      // profiles 表可能不存在或无权访问，忽略
    }
    // 头像签名 URL 有效期短（最长 1 小时），每次刷新页面重新签名，避免头像过期失效
    if (custom.avatarUrl && cloud.storage) {
      try {
        const path = cloud.storage.userPath(uid, "avatar");
        const { data: urlData } = await cloud.storage.createSignedUrl(path, 3600);
        const fresh = urlData?.url || urlData?.signedUrl || "";
        if (fresh) custom.avatarUrl = fresh;
      } catch (e) {
        // 重新签名失败则沿用已存 URL，不阻断登录
      }
    }
  }

  const displayName = custom.name || name || phone || email || "已登录";
  currentUserInfo = {
    uid, name, phone, email, avatarUrl,
    customName: custom.name, customAvatarUrl: custom.avatarUrl,
    displayName,
  };

  nameEl.textContent = displayName;
  const initial = (displayName || "用").charAt(0);
  applyAvatar(avatarEls, custom.avatarUrl, initial);
  // 已登录：只显示头像，隐藏登录按钮
  if (loginBtn) loginBtn.hidden = true;
  if (topAvatar) topAvatar.hidden = false;

  // 登录后自动认领负责人身份：若自己的手机号在 admins 表但尚未绑定 uid，则补上（用于数据库 RLS 判定管理员）
  claimAdminIfNeeded();

  // 登录状态变化后，刷新各页面的权限控件（添加活动按钮、记账按钮等）
  if (typeof checkReminderPermission === "function") checkReminderPermission();
  if (typeof checkScorePermission === "function") {
    checkScorePermission().then(() => {
      const ranking = document.getElementById("subtab-ranking");
      if (ranking && !ranking.hidden) loadScores();
    });
  }
}

// 给头像元素设置显示：有自定义头像则用图片，否则用首字母
function applyAvatar(els, avatarUrl, initial) {
  els.forEach((a) => {
    if (avatarUrl) {
      a.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    } else {
      a.textContent = initial;
    }
  });
}

async function claimAdminIfNeeded() {
  if (!cloud) return;
  try {
    const u = await cloud.auth.getUser();
    const phone = u.data?.phone ? normalizePhone(u.data.phone) : "";
    if (!phone) return;
    const { data } = await cloud.database.from("admins").select("id, uid").eq("phone", phone);
    const rec = data && data[0];
    if (rec && !rec.uid) {
      // 该手机号已设为负责人但还没绑定 uid，补上
      await cloud.database.rpc("claim_admin", { phone_input: phone });
    }
  } catch (e) {
    // 忽略认领失败，不影响正常使用
  }
}

// ===== 个人账号 =====
let pendingAvatarFile = null; // 待上传的头像文件

// 渲染「我的」页面
function renderProfile() {
  const loginCard = document.getElementById("profile-login-card");
  const panel = document.getElementById("profile-panel");

  if (!currentUserInfo) {
    // 未登录：显示引导卡片
    loginCard.hidden = false;
    panel.hidden = true;
    return;
  }

  loginCard.hidden = true;
  panel.hidden = false;

  const info = currentUserInfo;
  const name = info.customName || info.name || info.phone || info.email || "已登录";
  const avatarUrl = info.customAvatarUrl || info.avatarUrl || "";

  document.getElementById("profile-name").textContent = name;
  document.getElementById("profile-name-input").value = name;

  // 手机号/邮箱脱敏显示
  const contact = info.phone ? maskPhone(info.phone) : (info.email ? maskEmail(info.email) : "未绑定手机/邮箱");
  document.getElementById("profile-phone").textContent = contact;

  // 登录方式与账号
  let method = "—", account = "—";
  if (info.phone) { method = "手机号"; account = maskPhone(info.phone); }
  else if (info.email) { method = "邮箱"; account = maskEmail(info.email); }
  else if (info.name) { method = "WorkBuddy"; account = info.name; }
  document.getElementById("profile-login-method").textContent = method;
  document.getElementById("profile-account").textContent = account;

  // 负责人徽章
  const roleBadge = document.getElementById("profile-role-badge");
  const roleText = document.getElementById("profile-role");
  if (isAdminUser) {
    roleBadge.hidden = false;
    roleText.textContent = "负责人";
  } else {
    roleBadge.hidden = true;
    roleText.textContent = "普通成员";
  }

  // 头像
  const av = document.getElementById("profile-avatar");
  if (avatarUrl) {
    av.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
  } else {
    av.textContent = (name || "用").charAt(0);
  }

  document.getElementById("profile-error").textContent = "";
  pendingAvatarFile = null;

  // 成员身份认领
  renderMemberClaim();
}

// 加载并渲染「成员身份认领」区
async function renderMemberClaim() {
  const boundBox = document.getElementById("profile-claim-bound");
  const unboundBox = document.getElementById("profile-claim-unbound");
  const errEl = document.getElementById("profile-claim-error");
  errEl.textContent = "";

  if (!currentUserInfo || !cloud.database) return;
  const uid = currentUserInfo.uid;

  try {
    // 查我是否已认领某个成员
    const { data: mine } = await cloud.database.from("member_meta").select("name, role").eq("uid", uid).maybeSingle();
    if (mine) {
      // 已认领
      document.getElementById("profile-claim-name").textContent = mine.name || "";
      document.getElementById("profile-claim-role").textContent = mine.role || "";
      boundBox.hidden = false;
      unboundBox.hidden = true;
      return;
    }
    // 未认领：列出所有 active 且未被认领的成员（与 loadMemberOptions 一致的查询方式）
    const { data: all } = await cloud.database.from("member_meta").select("name, role, status, uid").order("name");
    const available = (all || []).filter((m) => m.status !== "disabled" && !m.uid);
    const select = document.getElementById("profile-claim-select");
    if (available.length === 0) {
      select.innerHTML = '<option value="">暂无可认领的成员</option>';
    } else {
      select.innerHTML = '<option value="">请选择你的名字</option>' +
        available.map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.role ? "（" + escapeHtml(m.role) + "）" : ""}</option>`).join("");
    }
    boundBox.hidden = true;
    unboundBox.hidden = false;
  } catch (e) {
    // 忽略，保持默认未认领
    boundBox.hidden = true;
    unboundBox.hidden = false;
  }
}

function maskPhone(p) {
  const s = normalizePhone(p);
  if (s.length >= 11) return s.slice(0, 3) + "****" + s.slice(-4);
  return p;
}
function maskEmail(e) {
  const [local, domain] = String(e).split("@");
  if (!domain) return e;
  const head = local.slice(0, 2) + "***";
  return head + "@" + domain;
}

// 未登录时的登录按钮
document.getElementById("profile-guest-login").addEventListener("click", () => openAuthDialog());

// 绑定成员身份
document.getElementById("profile-claim-btn").addEventListener("click", async () => {
  const errEl = document.getElementById("profile-claim-error");
  errEl.textContent = "";
  const name = document.getElementById("profile-claim-select").value;
  if (!name) { errEl.textContent = "请先在列表里选择你的名字"; return; }
  const uid = currentUserInfo?.uid;
  if (!uid || !cloud.database) { errEl.textContent = "当前账号不支持绑定身份"; return; }
  try {
    // 通过 RPC（SECURITY DEFINER）认领，绕过 member_meta 仅管理员可更新的 RLS 限制
    const { data: ok } = await cloud.database.rpc("claim_member", { member_name: name });
    if (!ok) { errEl.textContent = "该成员已被其他账号绑定"; }
    await renderMemberClaim();
    await refreshUser();
  } catch (e) {
    errEl.textContent = "绑定失败：" + (e.message || "请稍后重试");
  }
});

// 解除成员身份绑定
document.getElementById("profile-claim-unbind").addEventListener("click", async () => {
  const errEl = document.getElementById("profile-claim-error");
  errEl.textContent = "";
  const uid = currentUserInfo?.uid;
  if (!uid || !cloud.database) { errEl.textContent = "当前账号不支持解绑"; return; }
  try {
    await cloud.database.rpc("unclaim_member", {});
    await renderMemberClaim();
  } catch (e) {
    errEl.textContent = "解绑失败：" + (e.message || "请稍后重试");
  }
});

// 保存昵称
document.getElementById("profile-save").addEventListener("click", async () => {
  const errEl = document.getElementById("profile-error");
  errEl.textContent = "";
  const name = document.getElementById("profile-name-input").value.trim();
  if (!name) { errEl.textContent = "昵称不能为空"; return; }

  const uid = currentUserInfo.uid;
  if (!uid || !cloud.database) { errEl.textContent = "当前账号不支持保存昵称"; return; }

  try {
    // upsert 到 profiles 表
    await cloud.database.from("profiles").upsert(
      { uid, name, updated_at: new Date().toISOString() },
      { onConflict: "uid" }
    );
    // 上传头像（若有待上传文件）
    if (pendingAvatarFile) {
      const path = cloud.storage.userPath(uid, "avatar");
      // 先删除旧头像，避免「路径已存在」导致覆盖失败（后端对 upsert 头支持不稳定）
      try {
        await cloud.storage.remove([path]);
      } catch (e) {
        // 旧头像可能不存在，忽略删除失败
      }
      const { error: upErr } = await cloud.storage.upload(path, pendingAvatarFile, {
        contentType: pendingAvatarFile.type || "image/png",
        upsert: true,
      });
      if (upErr) { errEl.textContent = "头像上传失败：" + (upErr.message || upErr); return; }
      // 生成签名 URL 存到 profiles（SDK 限制 1~3600 秒，取最大值 1 小时）
      const { data: urlData } = await cloud.storage.createSignedUrl(path, 3600);
      const avatarUrl = urlData?.url || urlData?.signedUrl || urlData || "";
      if (avatarUrl) {
        await cloud.database.from("profiles").upsert(
          { uid, avatar_url: avatarUrl },
          { onConflict: "uid" }
        );
      }
    }
    errEl.textContent = "";
    await refreshUser();
    renderProfile();
  } catch (e) {
    errEl.textContent = "保存失败：" + (e.message || "请稍后重试");
  }
});

// 选择头像文件
document.getElementById("profile-upload-avatar").addEventListener("click", () => {
  document.getElementById("profile-avatar-file").click();
});
document.getElementById("profile-avatar-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  // 限制大小 2MB
  if (file.size > 2 * 1024 * 1024) {
    document.getElementById("profile-error").textContent = "图片不能超过 2MB";
    e.target.value = "";
    return;
  }
  pendingAvatarFile = file;
  // 本地预览
  const reader = new FileReader();
  reader.onload = () => {
    const av = document.getElementById("profile-avatar");
    av.innerHTML = `<img src="${reader.result}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
  };
  reader.readAsDataURL(file);
});

// 恢复默认头像
document.getElementById("profile-remove-avatar").addEventListener("click", async () => {
  const errEl = document.getElementById("profile-error");
  errEl.textContent = "";
  const uid = currentUserInfo?.uid;
  if (!uid || !cloud.database) { errEl.textContent = "当前账号不支持修改头像"; return; }
  try {
    await cloud.database.from("profiles").upsert({ uid, avatar_url: "" }, { onConflict: "uid" });
    pendingAvatarFile = null;
    const name = document.getElementById("profile-name-input").value.trim() || "用";
    document.getElementById("profile-avatar").textContent = name.charAt(0);
    await refreshUser();
    errEl.textContent = "";
  } catch (e) {
    errEl.textContent = "操作失败：" + (e.message || "");
  }
});

// 退出登录
document.getElementById("profile-logout").addEventListener("click", async () => {
  if (!cloud) return;
  if (!confirm("确定要退出登录吗？")) return;
  try {
    await cloud.auth.signOut();
    currentUserInfo = null;
    await refreshUser();
    renderProfile();
  } catch (e) {
    alert("退出失败：" + (e.message || "请重试"));
  }
});

// ===== 启动 =====
async function bootstrap() {
  const ok = initCloud();
  if (ok) {
    await refreshUser();
    // 预加载模板
    loadTemplates();
    loadTemplateOptions();
    // 预加载概览页三个指标 + 检测到点提醒
    updateReminderMetric();
    updateTemplateMetric();
    updateActiveMemberMetricFromDb();
    checkDueReminders();
    // 处理 OAuth 回调
    const url = new URL(location.href);
    if (url.searchParams.has("code") || url.searchParams.has("error")) {
      const provider = url.searchParams.get("provider");
      if (provider === "workbuddy" && typeof cloud.auth.handleWorkBuddyCallback === "function") {
        const { data: session, error } = await cloud.auth.handleWorkBuddyCallback.call(cloud.auth);
        if (error) {
          showAuthError(error.message || "登录失败");
          openAuthDialog();
        } else if (session) {
          for (const key of ["code", "state", "provider"]) url.searchParams.delete(key);
          history.replaceState(null, "", url.pathname + url.search + url.hash);
          await refreshUser();
        }
      }
    }
  }
  // 增强两处子标签为橡皮筋分段选择器
  initRubberSegments();
  // 为概览页三个指标卡片添加光晕效果
  initBorderGlow();
}

// ===== 公文模板模块 =====
const CATEGORY_LABELS = {
  notice: "通知类",
  post: "推文宣传类",
  format: "格式要求",
};
const PENDING_CATEGORY_PREFIX = "pending:";
const PENDING_SAMPLE_TITLE = "pending";
const SCORE_NEW_GROUP = 5;
const SCORE_NEW_SAMPLE = 3;
let templateApplyMode = null; // "group" 申请新建大类；"sample" 申请添加范文

function isPendingGroup(category) {
  return String(category || "").startsWith(PENDING_CATEGORY_PREFIX);
}

function realCategory(category) {
  return isPendingGroup(category) ? String(category).slice(PENDING_CATEGORY_PREFIX.length) : category;
}

async function getBoundMemberName() {
  const uid = currentUserInfo?.uid;
  if (!uid || !cloud?.database) return "";
  const { data } = await cloud.database.from("member_meta").select("name, status").eq("uid", uid).maybeSingle();
  if (!data || data.status === "disabled") return "";
  return data.name || "";
}

async function addTemplateScore(member, delta, reason) {
  const { error } = await cloud.database.from("scores").insert({
    member,
    delta,
    reason,
    owner_name: currentUserInfo?.name || currentUserPhone || "负责人",
  });
  return error;
}

// 子标签切换
document.querySelectorAll(".sub-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".sub-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.subtab;
    document.getElementById("subtab-template-lib").hidden = target !== "template-lib";
    document.getElementById("subtab-generate").hidden = target !== "generate";
    if (target === "template-lib") loadTemplates();
    if (target === "generate") loadTemplateOptions();
  });
});

// 模板弹窗（新建主题 / 添加范文）
const templateDialog = document.getElementById("template-dialog");
let editingGroupId = null; // 非 null = 添加范文模式；null = 新建主题模式

function openTemplateDialog(group, mode) {
  editingGroupId = group ? group.id : null;
  templateApplyMode = mode || null;
  const titleEl = document.getElementById("template-dialog-title");
  const nameField = document.getElementById("template-name");
  const categoryField = document.getElementById("template-category");
  const contentEl = document.getElementById("template-content");
  const contentLabel = document.getElementById("template-content-label");
  const groupFields = document.getElementById("template-group-fields");
  const groupHint = document.getElementById("template-group-hint");
  const groupHintBox = document.getElementById("template-group-hint-box");
  const hint = document.getElementById("template-apply-hint");
  const saveBtn = document.getElementById("template-save");

  document.getElementById("template-error").textContent = "";
  hint.hidden = true;
  hint.textContent = "";
  saveBtn.textContent = "保存";

  if (group) {
    titleEl.textContent = mode === "apply-sample" ? "申请添加范文" : "添加范文";
    nameField.value = "";
    categoryField.value = "notice";
    contentEl.value = "";
    contentLabel.textContent = "范文内容";
    groupFields.hidden = true;
    groupHint.hidden = false;
    groupHintBox.textContent = `${group.title}（${CATEGORY_LABELS[realCategory(group.category)] || "其他"}）`;
    if (mode === "apply-sample") {
      hint.hidden = false;
      hint.textContent = "提交后由负责人审核。通过后，这份范文会加入该大类，并为你自动加 3 分。";
      saveBtn.textContent = "提交申请";
    }
  } else {
    titleEl.textContent = mode === "apply-group" ? "申请新建大类" : "新建主题";
    nameField.value = "";
    categoryField.value = "notice";
    contentEl.value = "";
    contentLabel.textContent = "第一份范文内容";
    groupFields.hidden = false;
    groupHint.hidden = true;
    groupHintBox.textContent = "";
    if (mode === "apply-group") {
      hint.hidden = false;
      hint.textContent = "提交后由负责人审核。通过后，这个大类会加入模板库，并为你自动加 5 分。";
      saveBtn.textContent = "提交申请";
    }
  }
  templateDialog.showModal();
}

document.getElementById("btn-add-template").addEventListener("click", async () => {
  if (cloud) await checkScorePermission();
  if (isAdminUser) {
    openTemplateDialog(null);
    return;
  }
  const session = cloud ? await cloud.auth.getSession() : { data: null };
  if (!session?.data) {
    showPermissionToast("请先登录，再向负责人申请新建大类。");
    return;
  }
  const memberName = await getBoundMemberName();
  if (!memberName) {
    showPermissionToast("请先在「我的」绑定成员身份，再申请新建大类。");
    return;
  }
  openTemplateDialog(null, "apply-group");
});
document.getElementById("template-close").addEventListener("click", () => templateDialog.close());

document.getElementById("template-save").addEventListener("click", async () => {
  if (!cloud) { showTemplateError("服务未连接"); return; }
  const session = await cloud.auth.getSession();
  if (session.error || !session.data) {
    showTemplateError("请先登录后再操作");
    return;
  }
  const content = document.getElementById("template-content").value.trim();
  showTemplateError("");
  if (!content) { showTemplateError("请填写范文内容"); return; }

  const ownerName = session.data.user?.name ?? null;
  const applying = templateApplyMode === "apply-group" || templateApplyMode === "apply-sample";
  let applicant = ownerName;
  if (applying) {
    applicant = await getBoundMemberName();
    if (!applicant) { showTemplateError("请先在「我的」绑定成员身份后再申请。"); return; }
  }

  if (editingGroupId) {
    const { error } = await cloud.database.from("templates").insert({
      group_id: editingGroupId,
      content,
      owner_name: applying ? applicant : ownerName,
      title: templateApplyMode === "apply-sample" ? PENDING_SAMPLE_TITLE : "",
      category: "",
    });
    if (error) { showTemplateError("保存失败：" + (error.message || "")); return; }
    if (templateApplyMode === "apply-sample") {
      showPermissionToast("申请已提交，负责人通过后自动加 3 分。");
    }
  } else {
    if (templateApplyMode !== "apply-group") {
      if (cloud) await checkScorePermission();
      if (!isAdminUser) {
        showTemplateError("你没有权限新建主题，请先向负责人申请。");
        return;
      }
    }
    const name = document.getElementById("template-name").value.trim();
    const category = document.getElementById("template-category").value;
    if (!name) { showTemplateError("请填写主题名称"); return; }
    const storedCategory = templateApplyMode === "apply-group" ? PENDING_CATEGORY_PREFIX + category : category;

    const { data: groupData, error: groupErr } = await cloud.database
      .from("template_groups")
      .insert({ title: name, category: storedCategory, owner_name: applying ? applicant : ownerName })
      .select();
    if (groupErr) { showTemplateError("创建主题失败：" + (groupErr.message || "")); return; }
    const groupId = groupData?.[0]?.id;
    if (!groupId) { showTemplateError("创建主题失败：未返回主题ID"); return; }

    const { error } = await cloud.database.from("templates").insert({
      group_id: groupId,
      content,
      owner_name: applying ? applicant : ownerName,
      title: "",
      category: "",
    });
    if (error) { showTemplateError("保存范文失败：" + (error.message || "")); return; }
    if (templateApplyMode === "apply-group") {
      showPermissionToast("申请已提交，负责人通过后自动加 5 分。");
    }
  }
  templateApplyMode = null;
  templateDialog.close();
  await loadTemplates();
});

function showTemplateError(msg) {
  document.getElementById("template-error").textContent = msg || "";
}

function renderTemplateReview(reviewEl, pendingGroups, pendingSamples, byGroup, liveGroups, myName) {
  if (!reviewEl) return;
  const visibleGroups = pendingGroups.filter((g) => isAdminUser || (myName && g.owner_name === myName));
  const visibleSamples = pendingSamples.filter((t) => isAdminUser || (myName && t.owner_name === myName));
  if (visibleGroups.length === 0 && visibleSamples.length === 0) {
    reviewEl.hidden = true;
    reviewEl.innerHTML = "";
    return;
  }
  reviewEl.hidden = false;
  const groupHtml = visibleGroups.map((g) => {
    const cat = CATEGORY_LABELS[realCategory(g.category)] || "其他";
    const sample = (byGroup[g.id] || [])[0];
    const actions = isAdminUser
      ? `<div class="template-review-actions">
          <button class="template-review-pass" type="button" data-review="approve-group" data-id="${g.id}" data-member="${escapeHtml(g.owner_name || "")}" data-title="${escapeHtml(g.title || "")}" data-category="${escapeHtml(realCategory(g.category))}">通过</button>
          <button class="template-review-reject" type="button" data-review="reject-group" data-id="${g.id}" data-title="${escapeHtml(g.title || "")}">驳回</button>
        </div>`
      : `<span class="template-review-wait">审核中</span>`;
    return `<div class="card template-review-card">
      <div class="template-review-row">
        <div class="template-review-info">
          <span class="template-cat">新建大类 · ${cat} · 通过 +${SCORE_NEW_GROUP}</span>
          <strong class="template-review-title">${escapeHtml(g.title)}</strong>
          <span class="template-review-meta">申请人：${escapeHtml(g.owner_name || "未知")}</span>
        </div>
        ${actions}
      </div>
      ${sample?.content ? `<details class="template-review-detail"><summary>查看范文内容</summary><pre>${escapeHtml(sample.content)}</pre></details>` : ""}
    </div>`;
  }).join("");
  const sampleHtml = visibleSamples.map((t) => {
    const g = liveGroups.find((x) => String(x.id) === String(t.group_id));
    const actions = isAdminUser
      ? `<div class="template-review-actions">
          <button class="template-review-pass" type="button" data-review="approve-sample" data-id="${t.id}" data-member="${escapeHtml(t.owner_name || "")}" data-title="${escapeHtml(g?.title || "")}">通过</button>
          <button class="template-review-reject" type="button" data-review="reject-sample" data-id="${t.id}">驳回</button>
        </div>`
      : `<span class="template-review-wait">审核中</span>`;
    return `<div class="card template-review-card">
      <div class="template-review-row">
        <div class="template-review-info">
          <span class="template-cat">已有大类范文 · 通过 +${SCORE_NEW_SAMPLE}</span>
          <strong class="template-review-title">${escapeHtml(g?.title || "大类")}</strong>
          <span class="template-review-meta">申请人：${escapeHtml(t.owner_name || "未知")}</span>
        </div>
        ${actions}
      </div>
      ${t.content ? `<details class="template-review-detail"><summary>查看范文内容</summary><pre>${escapeHtml(t.content)}</pre></details>` : ""}
    </div>`;
  }).join("");
  reviewEl.innerHTML = groupHtml + sampleHtml;
  reviewEl.querySelectorAll("[data-review]").forEach((btn) => {
    btn.addEventListener("click", () => handleTemplateReview(btn));
  });
}

async function handleTemplateReview(btn) {
  if (!isAdminUser) return;
  const act = btn.dataset.review;
  const id = btn.dataset.id;
  const member = btn.dataset.member || "";
  const title = btn.dataset.title || "";
  if (act === "approve-group") {
    if (!confirm(`通过大类「${title}」吗？\n\n通过后加入模板库，并为「${member}」加 ${SCORE_NEW_GROUP} 分。`)) return;
    const { error } = await cloud.database.from("template_groups").update({ category: btn.dataset.category }).eq("id", id);
    if (error) { alert("通过失败：" + (error.message || "")); return; }
    if (!member) {
      alert("大类已通过，但申请人没有绑定成员身份，未能加分。");
    } else {
      const scoreError = await addTemplateScore(member, SCORE_NEW_GROUP, `新建公文大类「${title}」审核通过`);
      if (scoreError) alert("大类已通过，但加分失败：" + (scoreError.message || ""));
      else showPermissionToast(`已通过，已为「${member}」加 ${SCORE_NEW_GROUP} 分。`);
    }
  } else if (act === "reject-group") {
    if (!confirm(`驳回大类「${title}」吗？\n\n驳回后申请会被删除，不加分。`)) return;
    await cloud.database.from("templates").delete().eq("group_id", id);
    const { error } = await cloud.database.from("template_groups").delete().eq("id", id);
    if (error) { alert("驳回失败：" + (error.message || "")); return; }
  } else if (act === "approve-sample") {
    if (!confirm(`通过这份范文吗？\n\n通过后加入「${title}」，并为「${member}」加 ${SCORE_NEW_SAMPLE} 分。`)) return;
    const { error } = await cloud.database.from("templates").update({ title: "" }).eq("id", id);
    if (error) { alert("通过失败：" + (error.message || "")); return; }
    if (!member) {
      alert("范文已通过，但申请人没有绑定成员身份，未能加分。");
    } else {
      const scoreError = await addTemplateScore(member, SCORE_NEW_SAMPLE, `提交「${title}」范文审核通过`);
      if (scoreError) alert("范文已通过，但加分失败：" + (scoreError.message || ""));
      else showPermissionToast(`已通过，已为「${member}」加 ${SCORE_NEW_SAMPLE} 分。`);
    }
  } else if (act === "reject-sample") {
    if (!confirm("驳回这份范文吗？\n\n驳回后申请会被删除，不加分。")) return;
    const { error } = await cloud.database.from("templates").delete().eq("id", id);
    if (error) { alert("驳回失败：" + (error.message || "")); return; }
  }
  await loadTemplates();
  await loadScores();
}

// 加载主题列表（含各主题的范文）
async function loadTemplates() {
  if (!cloud) return;
  const listEl = document.getElementById("template-list");
  const emptyEl = document.getElementById("template-empty");

  const { data: groups, error } = await cloud.database
    .from("template_groups")
    .select("*")
    .order("created_at", { ascending: false });

  await checkScorePermission();
  const myName = await getBoundMemberName();
  const reviewEl = document.getElementById("template-review");

  if (error) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    if (reviewEl) reviewEl.hidden = true;
    return;
  }

  const allGroups = groups || [];
  const { data: tpls, error: tplErr } = await cloud.database
    .from("templates")
    .select("id, group_id, content, title, owner_name, created_at")
    .order("created_at", { ascending: true });

  const byGroup = {};
  if (!tplErr && tpls) {
    tpls.forEach((t) => {
      if (t.group_id == null) return;
      (byGroup[t.group_id] = byGroup[t.group_id] || []).push(t);
    });
  }

  const pendingGroups = allGroups.filter((g) => isPendingGroup(g.category));
  const liveGroups = allGroups.filter((g) => !isPendingGroup(g.category));
  const pendingSamples = (tpls || []).filter((t) => t.title === PENDING_SAMPLE_TITLE && liveGroups.some((g) => String(g.id) === String(t.group_id)));

  renderTemplateReview(reviewEl, pendingGroups, pendingSamples, byGroup, liveGroups, myName);

  if (liveGroups.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;
  listEl.innerHTML = liveGroups
    .map((g) => {
      const cat = CATEGORY_LABELS[g.category] || g.category || "其他";
      const catClass = g.category === "post" ? "post" : g.category === "format" ? "format" : "";
      const items = (byGroup[g.id] || []).filter((t) => t.title !== PENDING_SAMPLE_TITLE);
      const count = items.length;
      const itemsHtml = items
        .map((t, i) => `
          <div class="template-item" data-id="${t.id}">
            <div class="template-item-head">
              <span class="template-item-no">范文 ${i + 1}</span>
              <button class="template-del" data-id="${t.id}" data-gid="${g.id}">删除</button>
            </div>
            <pre>${escapeHtml(t.content)}</pre>
          </div>`)
        .join("");
      return `
        <div class="card template-group-card" data-id="${g.id}">
          <div class="template-group-head">
            <div class="template-group-title">
              <span class="template-cat ${catClass}">${cat}</span>
              <h3>${escapeHtml(g.title)}</h3>
              <span class="template-count">${count} 份范文</span>
            </div>
            <div class="template-group-actions">
              <button class="template-add-item" data-id="${g.id}">＋ 添加范文</button>
              <button class="template-del-group" data-id="${g.id}">删除主题</button>
            </div>
          </div>
          <div class="template-items">${itemsHtml || '<div class="template-item-empty">该主题下还没有范文</div>'}</div>
        </div>`;
    })
    .join("");

  // 添加范文：负责人直接加入，普通成员提交申请
  listEl.querySelectorAll(".template-add-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const g = liveGroups.find((x) => String(x.id) === String(btn.dataset.id));
      if (!g) return;
      if (cloud) await checkScorePermission();
      if (isAdminUser) {
        openTemplateDialog(g);
        return;
      }
      const session = cloud ? await cloud.auth.getSession() : { data: null };
      if (!session?.data) {
        showPermissionToast("请先登录，再申请添加范文。");
        return;
      }
      const memberName = await getBoundMemberName();
      if (!memberName) {
        showPermissionToast("请先在「我的」绑定成员身份，再申请添加范文。");
        return;
      }
      openTemplateDialog(g, "apply-sample");
    });
  });

  // 删除范文
  listEl.querySelectorAll(".template-del").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除这份范文吗？")) return;
      const { error } = await cloud.database
        .from("templates")
        .delete()
        .eq("id", btn.dataset.id);
      if (!error) await loadTemplates();
    });
  });

  // 删除主题（级联删除其下范文）
  listEl.querySelectorAll(".template-del-group").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("确定删除整个主题吗？其下的所有范文也会一并删除。")) return;
      const gid = btn.dataset.id;
      // 先删范文，再删主题
      await cloud.database.from("templates").delete().eq("group_id", gid);
      const { error } = await cloud.database
        .from("template_groups")
        .delete()
        .eq("id", gid);
      if (!error) await loadTemplates();
    });
  });
}

// 加载生成页的主题下拉选项（按当前生成类型过滤分类）
async function loadTemplateOptions() {
  if (!cloud) return;
  const select = document.getElementById("gen-template-select");
  const { data, error } = await cloud.database
    .from("template_groups")
    .select("id, title, category")
    .order("created_at", { ascending: false });

  if (error || !data) {
    select.innerHTML = '<option value="">不使用主题（用通用格式）</option>';
    return;
  }

  // 按生成类型过滤：通知类型只显示"通知类+格式要求"，推文类型只显示"推文宣传类+格式要求"
  const targetCat = genType === "post" ? "post" : "notice";
  const filtered = data.filter((g) => g.category === targetCat || g.category === "format");

  const options = filtered
    .map((g) => `<option value="${g.id}">${escapeHtml(g.title)}（${CATEGORY_LABELS[g.category] || "其他"}）</option>`)
    .join("");
  select.innerHTML = '<option value="">不使用主题（用通用格式）</option>' + options;
}

// 生成类型切换
let genType = "notice";
document.querySelectorAll(".gen-type").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".gen-type").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    genType = btn.dataset.type;
    // 切换类型后，重新加载匹配分类的主题下拉
    loadTemplateOptions();
  });
});

// ===== 图片资料上传 =====
const MAX_IMAGES = 4;              // 图片数量上限
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 单图大小上限 5MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
let genImages = []; // [{ dataUrl, name }]

const imageDrop = document.getElementById("gen-image-drop");
const imageInput = document.getElementById("gen-image-input");
const imageList = document.getElementById("gen-image-list");
const imageError = document.getElementById("gen-image-error");

function showImageError(msg) { imageError.textContent = msg || ""; }

imageDrop.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => {
  addImages([...imageInput.files]);
  imageInput.value = "";
});

// 拖拽
imageDrop.addEventListener("dragover", (e) => { e.preventDefault(); imageDrop.classList.add("dragover"); });
imageDrop.addEventListener("dragleave", () => imageDrop.classList.remove("dragover"));
imageDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  imageDrop.classList.remove("dragover");
  addImages([...e.dataTransfer.files]);
});

// 粘贴
document.addEventListener("paste", (e) => {
  // 仅当生成子页可见时才处理粘贴图片
  const genView = document.getElementById("subtab-generate");
  if (genView.hidden) return;
  const items = [...(e.clipboardData?.items || [])];
  const files = items
    .filter((it) => it.kind === "file" && ALLOWED_IMAGE_TYPES.includes(it.type))
    .map((it) => it.getAsFile());
  if (files.length) addImages(files);
});

function addImages(files) {
  showImageError("");
  const room = MAX_IMAGES - genImages.length;
  const toAdd = files.slice(0, room);
  if (files.length > room) {
    showImageError(`图片最多 ${MAX_IMAGES} 张，已忽略多余的 ${files.length - room} 张`);
  }
  for (const f of toAdd) {
    if (!ALLOWED_IMAGE_TYPES.includes(f.type)) {
      showImageError(`不支持的文件格式：${f.name || f.type}（仅支持 jpg / png / webp）`);
      continue;
    }
    if (f.size > MAX_IMAGE_SIZE) {
      showImageError(`图片「${f.name}」超过 5MB，已跳过`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      genImages.push({ dataUrl: reader.result, name: f.name });
      renderImages();
    };
    reader.readAsDataURL(f);
  }
}

function renderImages() {
  imageList.innerHTML = genImages
    .map((img, i) => `
      <div class="gen-image-item" data-idx="${i}">
        <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" />
        <span class="gen-image-index">${i + 1}</span>
        <button class="gen-image-del" data-idx="${i}" title="删除">×</button>
      </div>`)
    .join("");
  imageList.querySelectorAll(".gen-image-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      genImages.splice(Number(btn.dataset.idx), 1);
      renderImages();
      showImageError("");
    });
  });
}

document.getElementById("btn-clear").addEventListener("click", () => {
  document.getElementById("gen-material").value = "";
  document.getElementById("gen-error").textContent = "";
});

// 生成公文
document.getElementById("btn-generate").addEventListener("click", async () => {
  if (!cloud) { showGenError("服务未连接"); return; }
  const session = await cloud.auth.getSession();
  if (session.error || !session.data) {
    showGenError("请先登录后再使用生成功能");
    return;
  }

  const material = document.getElementById("gen-material").value.trim();
  showGenError("");
  if (!material) { showGenError("请先填写资料内容"); return; }

  // 获取选中的主题及其下所有范文
  const groupId = document.getElementById("gen-template-select").value;
  let templateContent = "";
  if (groupId) {
    const { data: groupData } = await cloud.database
      .from("template_groups")
      .select("title")
      .eq("id", groupId)
      .maybeSingle();
    const { data: tpls } = await cloud.database
      .from("templates")
      .select("content, title")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    const title = groupData?.title || "参考主题";
    const contents = (tpls || []).filter((t) => t.title !== PENDING_SAMPLE_TITLE).map((t) => t.content).filter(Boolean);
    if (contents.length > 0) {
      templateContent = `主题「${title}」下共有 ${contents.length} 份范文，请综合参考它们的格式与措辞风格：\n\n` +
        contents.map((c, i) => `【范文 ${i + 1}】\n${c}`).join("\n\n");
    }
  }

  // 显示加载态
  const resultEmpty = document.getElementById("gen-result-empty");
  const resultText = document.getElementById("gen-result-text");
  const resultActions = document.getElementById("gen-result-actions");
  resultEmpty.innerHTML = '<div class="gen-loading">AI 正在生成，请稍候…</div>';
  resultEmpty.hidden = false;
  resultText.hidden = true;
  resultActions.hidden = true;

  try {
    // 获取模型列表；有图片时必须选支持图片的模型
    const models = await cloud.llm.models.list();
    const hasImages = genImages.length > 0;
    let model = models.find((m) => {
      if (m.disabled === true) return false;
      return hasImages ? m.supportsImages === true : true;
    });
    if (!model) {
      showGenError(hasImages ? "暂无可处理图片的 AI 模型" : "暂无可用的 AI 模型");
      resultEmpty.innerHTML = '<div class="empty-icon"><i data-icon="spark"></i></div><p>生成的通知或推文会显示在这里。</p>';
      return;
    }

    // 构建 prompt
    const systemPrompt = buildSystemPrompt(genType);
    const userPrompt = buildUserPrompt(genType, material, templateContent, genImages.length);

    // 构建多模态消息：有图片时用 content 数组
    let messages;
    if (hasImages) {
      const contentParts = [{ type: "text", text: userPrompt }];
      for (const img of genImages) {
        contentParts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: contentParts },
      ];
    } else {
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
    }

    let answer = "";
    for await (const chunk of cloud.llm.chat.completions.create({
      model: model.id,
      messages,
      stream: true,
    })) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) answer += delta;
    }

    if (!answer.trim()) {
      showGenError("生成结果为空，请重试");
      resultEmpty.hidden = false;
      resultEmpty.innerHTML = '<div class="empty-icon"><i data-icon="spark"></i></div><p>生成的通知或推文会显示在这里。</p>';
      return;
    }

    resultEmpty.hidden = true;
    resultText.hidden = false;
    resultText.textContent = answer.trim();
    resultActions.hidden = false;
  } catch (e) {
    showGenError("生成失败：" + (e?.error?.message || e?.message || "未知错误"));
    resultEmpty.hidden = false;
    resultEmpty.innerHTML = '<div class="empty-icon"><i data-icon="spark"></i></div><p>生成的通知或推文会显示在这里。</p>';
  }
});

function buildSystemPrompt(type) {
  if (type === "notice") {
    return "你是一位资深的学院公文写作专家，擅长撰写正式、规范的部门通知。你会严格遵循用户提供的模板或格式要求，信息完整、措辞得体、格式规范。输出纯文本，可直接复制粘贴到聊天群。";
  }
  return "你是一位资深的学院宣传文案专家，擅长撰写生动、有温度的推文。你会严格遵循用户提供的模板或格式要求，内容具体、有感染力、正能量。输出纯文本，可直接复制粘贴到聊天群。";
}

function buildUserPrompt(type, material, templateContent, imageCount) {
  const typeName = type === "notice" ? "通知" : "推文";
  let prompt = `请根据以下资料，撰写一篇${typeName}。\n\n`;
  if (templateContent) {
    prompt += `【参考范文】\n${templateContent}\n\n`;
  } else {
    prompt += "【格式要求】\n请使用标准公文体格式，标题、称谓、正文、落款完整。\n\n";
  }
  prompt += `【资料】\n${material}\n\n`;
  if (imageCount && imageCount > 0) {
    prompt += `【图片资料】\n本消息附带了 ${imageCount} 张图片（按顺序为第 1 张到第 ${imageCount} 张）。请仔细阅读每张图片中的信息（文字、时间、地点、人物、数据等），并把图片里的关键信息纳入成品正文。\n\n`;
    if (type === "post") {
      prompt += "【配图标注要求】\n由于这是推文，请在成品的合适位置用「【配图N：说明】」标注对应图片（N 为图片序号，说明为该图内容的一两句话概括），让读者知道哪里该插入第 N 张图。\n\n";
    }
  }
  prompt += "要求：\n1. 综合参考上述范文的格式与措辞风格（范文越多越能贴近你的习惯，但以本次资料为准）\n2. 信息来自资料和图片，不要编造\n3. 资料或图片中缺失的关键信息（如具体日期、部门名称）用【】标注占位\n4. 直接输出成品，不要解释说明";
  return prompt;
}

function showGenError(msg) {
  document.getElementById("gen-error").textContent = msg || "";
}

// 复制结果
document.getElementById("btn-copy-result").addEventListener("click", async () => {
  const text = document.getElementById("gen-result-text").textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("btn-copy-result");
    const old = btn.innerHTML;
    btn.innerHTML = "已复制 ✓";
    setTimeout(() => (btn.innerHTML = old), 1500);
  } catch (e) {
    // 降级方案
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    const btn = document.getElementById("btn-copy-result");
    const old = btn.innerHTML;
    btn.innerHTML = "已复制 ✓";
    setTimeout(() => (btn.innerHTML = old), 1500);
  }
});

// 工具函数
function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ===== 加减分模块 =====
const BASE_SCORE = 85; // 基础分
const EXCLUDED_MEMBERS = ["孙诗琪", "范佳宁", "陈健豪", "孙催办"]; // 不参与考核（负责人本人 / 测试账号）
const SUPER_ADMIN_PHONE = "15086653768"; // 唯一能清空记录的人

// 子标签切换（加减分页）
document.querySelectorAll('#view-scores .sub-tab').forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll('#view-scores .sub-tab').forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.subtab;
    document.getElementById("subtab-ranking").hidden = target !== "ranking";
    document.getElementById("subtab-score-entry").hidden = target !== "score-entry";
    document.getElementById("subtab-member-mgmt").hidden = target !== "member-mgmt";
    if (target === "ranking") { checkScorePermission().then(() => loadScores()); }
    if (target === "score-entry") { loadMemberOptions(); checkScorePermission(); }
    if (target === "member-mgmt") { loadMemberList(); loadAdminList(); }
  });
});

// 当前登录用户是否负责人（可记账）
let isAdminUser = false;
let currentUserPhone = null;

// 规范化手机号：去掉 +86、空格、连字符等，便于与 admins 表匹配
function normalizePhone(p) {
  if (!p) return "";
  return String(p).replace(/^\+86/, "").replace(/[\s\-()]/g, "");
}

async function checkScorePermission() {
  if (!cloud) return;
  const session = await cloud.auth.getSession();
  if (!session.data) { isAdminUser = false; renderScorePermission(); return; }
  // OTP 登录时 session.user 没有 phone 字段，需用 getUser() 获取
  let phone = session.data.user?.phone || "";
  if (!phone) {
    try {
      const u = await cloud.auth.getUser();
      phone = u.data?.phone || u.data?.email || "";
    } catch (e) {
      phone = "";
    }
  }
  phone = normalizePhone(phone);
  currentUserPhone = phone;
  // 用规范化后的手机号匹配，同时兼容表里可能存的带/不带 +86 两种格式
  const { data } = await cloud.database.from("admins").select("phone");
  const admins = data || [];
  isAdminUser = admins.some((a) => normalizePhone(a.phone) === phone && phone !== "");
  renderScorePermission();
}

function renderScorePermission() {
  const hint = document.getElementById("score-permission-hint");
  if (isAdminUser) {
    hint.textContent = "你是负责人，可以记账。";
  } else {
    hint.textContent = "你当前是只读身份，仅负责人可以记账。";
  }
  // 保存按钮不再 disabled，非负责人点击时弹出权限提示（见 click 回调）
  const saveBtn = document.getElementById("btn-score-save");
  if (saveBtn) saveBtn.disabled = false;
  // 清空全部记录按钮：始终显示，非超级管理员点击时弹出权限提示（见 click 回调）
}

// 加载成员下拉（记分用，排除停用成员和负责人）
async function loadMemberOptions() {
  if (!cloud) return;
  const select = document.getElementById("score-member");
  const { data } = await cloud.database.from("member_meta").select("name, status, role").order("name");
  const actives = (data || []).filter((m) => m.status !== "disabled" && !EXCLUDED_MEMBERS.includes(m.name));
  select.innerHTML = actives
    .map((m) => `<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}${m.role ? "（" + escapeHtml(m.role) + "）" : ""}</option>`)
    .join("");
}

// 加载成员名单（管理用）
async function loadMemberList() {
  if (!cloud) return;
  const listEl = document.getElementById("member-list");
  // 权限：仅管理员可增删改成员；按钮始终显示，点击时弹提示
  await checkScorePermission();
  document.getElementById("btn-add-member").hidden = false;
  const { data } = await cloud.database.from("member_meta").select("name, role, status, uid").order("name");
  if (!data || data.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>暂无成员，点击「添加成员」。</p></div>';
    return;
  }
  listEl.innerHTML = data
    .map((m) => {
      const disabled = m.status === "disabled";
      const bound = !!m.uid;
      const actions = isAdminUser
        ? `<div class="member-item-actions">
          <button data-act="edit" data-name="${escapeHtml(m.name)}">编辑</button>
          <button data-act="toggle" data-name="${escapeHtml(m.name)}">${disabled ? "启用" : "停用"}</button>
        </div>`
        : "";
      return `
      <div class="member-item ${disabled ? "disabled" : ""}">
        <span class="member-item-name">${escapeHtml(m.name)}</span>
        <span class="member-item-role">${escapeHtml(m.role || "")}</span>
        ${bound ? '<span class="member-item-bound" title="该成员已绑定登录账号">已绑定</span>' : ""}
        ${disabled ? '<span class="member-item-status">已停用</span>' : ""}
        ${actions}
      </div>`;
    })
    .join("");
  listEl.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isAdminUser) return;
      const name = btn.dataset.name;
      if (btn.dataset.act === "edit") {
        openMemberDialog(name);
      } else {
        const { data } = await cloud.database.from("member_meta").select("status").eq("name", name).maybeSingle();
        const next = data?.status === "disabled" ? "active" : "disabled";
        await cloud.database.from("member_meta").update({ status: next }).eq("name", name);
        await loadMemberList();
        await loadMemberOptions();
      }
    });
  });
}

// 添加/编辑成员
const memberDialog = document.getElementById("member-dialog");
let editingMemberName = null;

document.getElementById("btn-add-member").addEventListener("click", () => {
  if (!isAdminUser) { showPermissionToast("你没有权限添加成员，仅负责人可以操作。"); return; }
  editingMemberName = null;
  document.getElementById("member-dialog-title").textContent = "添加成员";
  document.getElementById("member-name").value = "";
  document.getElementById("member-role").value = "";
  document.getElementById("member-email").value = "";
  document.getElementById("member-error").textContent = "";
  memberDialog.showModal();
});
document.getElementById("member-close").addEventListener("click", () => memberDialog.close());

async function openMemberDialog(name) {
  editingMemberName = name;
  document.getElementById("member-dialog-title").textContent = "编辑成员";
  const { data } = await cloud.database.from("member_meta").select("name, role, email").eq("name", name).maybeSingle();
  document.getElementById("member-name").value = data?.name || name;
  document.getElementById("member-role").value = data?.role || "";
  document.getElementById("member-email").value = data?.email || "";
  document.getElementById("member-error").textContent = "";
  memberDialog.showModal();
}

document.getElementById("member-save").addEventListener("click", async () => {
  if (!cloud) { document.getElementById("member-error").textContent = "服务未连接"; return; }
  const name = document.getElementById("member-name").value.trim();
  const role = document.getElementById("member-role").value.trim();
  const email = document.getElementById("member-email").value.trim();
  if (!name) { document.getElementById("member-error").textContent = "请填写姓名"; return; }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById("member-error").textContent = "请输入正确的邮箱地址";
    return;
  }

  if (editingMemberName) {
    // 改名：需同步 members 表和 member_meta 表、scores 表的 member 字段
    await cloud.database.from("members").update({ name }).eq("name", editingMemberName);
    await cloud.database.from("scores").update({ member: name }).eq("member", editingMemberName);
    const { data: meta } = await cloud.database.from("member_meta").select("id").eq("name", editingMemberName).maybeSingle();
    if (meta) {
      await cloud.database.from("member_meta").update({ name, role, email }).eq("name", editingMemberName);
    }
  } else {
    const { data: exists } = await cloud.database.from("member_meta").select("id").eq("name", name).maybeSingle();
    if (exists) { document.getElementById("member-error").textContent = "该成员已存在"; return; }
    await cloud.database.from("members").insert({ name });
    await cloud.database.from("member_meta").insert({ name, role: role || "成员", status: "active", email: email || null });
  }
  memberDialog.close();
  await loadMemberList();
  await loadMemberOptions();
});

// 负责人管理
async function loadAdminList() {
  if (!cloud) return;
  const listEl = document.getElementById("admin-list");
  // 权限：仅管理员可管理负责人
  await checkScorePermission();
  const adminAddRow = document.getElementById("admin-add-row");
  if (adminAddRow) adminAddRow.hidden = !isAdminUser;
  const { data } = await cloud.database.from("admins").select("phone, name").order("created_at");
  if (!data || data.length === 0) {
    listEl.innerHTML = '<p class="card-heading-p">暂无负责人账号。</p>';
    return;
  }
  listEl.innerHTML = data
    .map((a) => {
      const delBtn = isAdminUser
        ? `<button data-phone="${escapeHtml(a.phone)}">取消负责人</button>`
        : "";
      return `
      <div class="admin-item">
        <span class="admin-item-phone">${escapeHtml(a.phone)}</span>
        <span class="admin-item-name">${escapeHtml(a.name || "")}</span>
        ${delBtn}
      </div>`;
    })
    .join("");
  listEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isAdminUser) return;
      await cloud.database.from("admins").delete().eq("phone", btn.dataset.phone);
      await loadAdminList();
    });
  });
}

document.getElementById("btn-add-admin").addEventListener("click", async () => {
  if (!cloud) return;
  if (!isAdminUser) { showPermissionToast("你没有权限授权负责人，仅管理员可以操作。"); return; }
  const phone = document.getElementById("admin-phone").value.trim();
  if (!/^1\d{10}$/.test(phone)) { alert("请输入正确的 11 位手机号"); return; }
  const { data: exists } = await cloud.database.from("admins").select("id").eq("phone", phone).maybeSingle();
  if (!exists) {
    await cloud.database.from("admins").insert({ phone });
  }
  document.getElementById("admin-phone").value = "";
  await loadAdminList();
});

// 记一笔
let scoreDir = "add"; // add | sub
document.querySelectorAll('#subtab-score-entry .gen-type[data-dir]').forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!isAdminUser) { showPermissionToast("你没有权限记账，仅负责人可以操作。"); return; }
    document.querySelectorAll('#subtab-score-entry .gen-type[data-dir]').forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scoreDir = btn.dataset.dir;
  });
});

// 快捷分值
let scoreVal = 1;
document.querySelectorAll(".score-quick-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!isAdminUser) { showPermissionToast("你没有权限记账，仅负责人可以操作。"); return; }
    document.querySelectorAll(".score-quick-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    scoreVal = Number(btn.dataset.val);
    document.getElementById("score-value").value = "";
  });
});
document.getElementById("score-value").addEventListener("input", (e) => {
  if (!isAdminUser) { showPermissionToast("你没有权限记账，仅负责人可以操作。"); e.target.value = ""; return; }
  if (e.target.value !== "") {
    document.querySelectorAll(".score-quick-btn").forEach((b) => b.classList.remove("active"));
    scoreVal = Number(e.target.value);
  }
});

// 默认日期今天
document.getElementById("score-date").value = new Date().toISOString().slice(0, 10);

function showScoreError(msg) { document.getElementById("score-error").textContent = msg || ""; }

// 轻量权限提示 toast（非负责人尝试越权操作时弹出）
let permissionToastTimer = null;
function showPermissionToast(msg) {
  let toast = document.getElementById("permission-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "permission-toast";
    toast.className = "permission-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(permissionToastTimer);
  permissionToastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2600);
}

document.getElementById("btn-score-save").addEventListener("click", async () => {
  if (!cloud) { showScoreError("服务未连接"); return; }
  if (!isAdminUser) { showPermissionToast("你没有权限记账，仅负责人可以操作。"); return; }
  showScoreError("");

  const member = document.getElementById("score-member").value;
  const reason = document.getElementById("score-reason").value.trim();
  const date = document.getElementById("score-date").value;
  const quickActive = document.querySelector(".score-quick-btn.active");
  let val;
  const customVal = document.getElementById("score-value").value.trim();
  if (customVal !== "") {
    val = Number(customVal);
  } else if (quickActive) {
    val = Number(quickActive.dataset.val);
  } else {
    val = scoreVal;
  }

  // 校验
  if (!member) { showScoreError("请选择成员"); return; }
  if (!reason) { showScoreError("请填写事由（加分/扣分理由）"); return; }
  if (!Number.isInteger(val) || val === 0) { showScoreError("分值必须是非零整数"); return; }

  const delta = scoreDir === "add" ? Math.abs(val) : -Math.abs(val);

  // 记录人（OTP 登录时 session.user 无 name/phone，需用 getUser()）
  let recorder = currentUserPhone || "未知";
  try {
    const u = await cloud.auth.getUser();
    recorder = u.data?.name || u.data?.phone || currentUserPhone || "未知";
  } catch (e) {
    recorder = currentUserPhone || "未知";
  }

  const { error } = await cloud.database.from("scores").insert({
    member,
    delta,
    reason,
    owner_name: recorder,
  });
  if (error) { showScoreError("保存失败：" + (error.message || "")); return; }

  // 清空事由，刷新排行
  document.getElementById("score-reason").value = "";
  document.getElementById("score-value").value = "";
  await loadScores();
});

// 汇总与排行
async function loadScores() {
  if (!cloud) return;
  const rankingEl = document.getElementById("score-ranking");
  const emptyEl = document.getElementById("score-ranking-empty");

  const { data: members } = await cloud.database.from("member_meta").select("name, role, status").order("name");
  const { data: scores } = await cloud.database.from("scores").select("member, delta, reason, owner_name, created_at").order("created_at", { ascending: true });

  const memberList = members || [];
  const scoreList = scores || [];

  // 计算每人累计分
  const totalMap = {};
  const detailMap = {};
  memberList.forEach((m) => {
    totalMap[m.name] = 0;
    detailMap[m.name] = [];
  });
  scoreList.forEach((s) => {
    if (!(s.member in totalMap)) totalMap[s.member] = 0;
    totalMap[s.member] += s.delta;
    if (!detailMap[s.member]) detailMap[s.member] = [];
    detailMap[s.member].push(s);
  });

  const ranking = memberList.map((m) => ({
    name: m.name,
    role: m.role,
    status: m.status,
    delta: totalMap[m.name] || 0,
    total: BASE_SCORE + (totalMap[m.name] || 0),
  }));

  // 只显示 active 成员，且排除负责人（不参与考核）
  const activeRanking = ranking
    .filter((r) => r.status !== "disabled" && !EXCLUDED_MEMBERS.includes(r.name))
    .sort((a, b) => b.total - a.total);

  if (activeRanking.length === 0) {
    rankingEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  rankingEl.innerHTML = activeRanking
    .map((r, i) => {
      const numClass = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
      const deltaStr = r.delta > 0 ? `+${r.delta}` : `${r.delta}`;
      return `
      <div class="score-rank-item" data-name="${escapeHtml(r.name)}">
        <span class="score-rank-num ${numClass}">${i + 1}</span>
        <div class="score-rank-info">
          <span class="score-rank-name">${escapeHtml(r.name)}</span>
          <span class="score-rank-role">${escapeHtml(r.role || "")}</span>
        </div>
        <span class="score-rank-delta">${deltaStr}</span>
        <span class="score-rank-total">${r.total}</span>
      </div>`;
    })
    .join("");

  // 点击看明细
  rankingEl.querySelectorAll(".score-rank-item").forEach((item) => {
    item.addEventListener("click", () => openMemberDetail(item.dataset.name, detailMap, memberList));
  });

  // 更新概览页活跃成员指标（本月有过加减分记录的成员数）
  updateActiveMemberMetric(scoreList);
}

async function openMemberDetail(name, detailMap, memberList) {
  const title = document.getElementById("member-detail-title");
  const summary = document.getElementById("member-detail-summary");
  const listEl = document.getElementById("member-detail-list");
  const meta = memberList.find((m) => m.name === name) || {};
  const detail = detailMap[name] || [];

  title.textContent = `${name} 的明细`;
  const total = BASE_SCORE + (detail.reduce((s, d) => s + d.delta, 0));
  summary.innerHTML = `职务：${escapeHtml(meta.role || "—")} ｜ 基础分 85 ｜ 当前总分 <b>${total}</b> ｜ 共 ${detail.length} 条记录`;

  if (detail.length === 0) {
    listEl.innerHTML = '<p class="card-heading-p">暂无加减分记录。</p>';
  } else {
    listEl.innerHTML = detail
      .slice()
      .reverse()
      .map((d) => {
        const pos = d.delta > 0;
        return `
        <div class="member-detail-item">
          <span class="member-detail-delta ${pos ? "pos" : "neg"}">${pos ? "+" : ""}${d.delta}</span>
          <span class="member-detail-reason">${escapeHtml(d.reason || "")}</span>
          <span class="member-detail-meta">${escapeHtml(d.owner_name || "")}<br>${formatDate(d.created_at)}</span>
        </div>`;
      })
      .join("");
  }
  document.getElementById("member-detail-dialog").showModal();
}
document.getElementById("member-detail-close").addEventListener("click", () => document.getElementById("member-detail-dialog").close());

// 概览页活跃成员指标（本月有过加减分记录的成员数）
function updateActiveMemberMetric(scoreList) {
  const el = document.getElementById("metric-members");
  if (!el) return;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const activeSet = new Set();
  scoreList.forEach((s) => {
    const d = new Date(s.created_at);
    if (d >= monthStart) activeSet.add(s.member);
  });
  el.textContent = activeSet.size;
}

// ===== 导出 Excel =====
document.getElementById("btn-export-excel").addEventListener("click", async () => {
  if (!cloud) return;
  const { data: members } = await cloud.database.from("member_meta").select("name, role, status").order("name");
  const { data: scores } = await cloud.database.from("scores").select("member, delta, reason, owner_name, created_at").order("created_at", { ascending: true });

  const memberList = (members || []).filter((m) => !EXCLUDED_MEMBERS.includes(m.name));
  const scoreList = scores || [];

  // 汇总 sheet：每人基础分85 + 加分/扣分分别统计 + 理由汇总
  const summaryRows = memberList.map((m) => {
    const mine = scoreList.filter((s) => s.member === m.name);
    let addSum = 0, subSum = 0;
    const addReasons = [], subReasons = [];
    mine.forEach((s) => {
      if (s.delta > 0) {
        addSum += s.delta;
        if (s.reason) addReasons.push(`+${s.delta} ${s.reason}`);
      } else if (s.delta < 0) {
        subSum += s.delta;
        if (s.reason) subReasons.push(`${s.delta} ${s.reason}`);
      }
    });
    const sum = addSum + subSum;
    return {
      排名: 0,
      姓名: m.name,
      职务: m.role || "",
      状态: m.status === "disabled" ? "已停用" : "正常",
      基础分: BASE_SCORE,
      累计加分: addSum || "",
      累计扣分: subSum || "",
      加分理由: addReasons.join("；") || "",
      扣分理由: subReasons.join("；") || "",
      当前总分: BASE_SCORE + sum,
    };
  });
  summaryRows.sort((a, b) => b["当前总分"] - a["当前总分"]);
  summaryRows.forEach((r, i) => (r["排名"] = i + 1));

  // 明细 sheet
  const detailRows = scoreList.map((s) => ({
    姓名: s.member,
    类型: s.delta > 0 ? "加分" : "扣分",
    分值: s.delta,
    理由: s.reason || "",
    记录人: s.owner_name || "",
    时间: formatDateTime(s.created_at),
  }));

  const summaryData = [
    ["排名", "姓名", "职务", "状态", "基础分", "累计加分", "累计扣分", "加分理由", "扣分理由", "当前总分"],
    ...summaryRows.map((r) => [
      r["排名"], r["姓名"], r["职务"], r["状态"], r["基础分"],
      r["累计加分"], r["累计扣分"], r["加分理由"], r["扣分理由"], r["当前总分"],
    ]),
  ];
  const detailData = [
    ["姓名", "类型", "分值", "理由", "记录人", "时间"],
    ...detailRows.map((r) => [r["姓名"], r["类型"], r["分值"], r["理由"], r["记录人"], r["时间"]]),
  ];

  // 优先用 SheetJS 生成真正的 .xlsx（两个 sheet）；未加载则降级 CSV
  if (typeof XLSX !== "undefined") {
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    const ws2 = XLSX.utils.aoa_to_sheet(detailData);
    // 设置列宽
    ws1["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 40 }, { wch: 40 }, { wch: 10 }];
    ws2["!cols"] = [{ wch: 10 }, { wch: 6 }, { wch: 8 }, { wch: 40 }, { wch: 12 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, "积分汇总");
    XLSX.utils.book_append_sheet(wb, ws2, "加减分明细");
    XLSX.writeFile(wb, `成员积分_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } else {
    // 降级：CSV（含 BOM，Excel 可打开）
    const summaryCSV = toCSV(summaryData);
    const detailCSV = toCSV(detailData);
    const content = "\uFEFF" + "成员积分汇总（基础分85）\n" + summaryCSV + "\n\n成员加减分明细\n" + detailCSV;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `成员积分_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
});

function toCSV(rows) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let s = cell == null ? "" : String(cell);
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            s = '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        })
        .join(",")
    )
    .join("\n");
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ===== 清空记录（仅超级管理员） =====
document.getElementById("btn-clear-records").addEventListener("click", async () => {
  if (!cloud) return;
  const phone = normalizePhone(currentUserPhone || "");
  if (phone !== SUPER_ADMIN_PHONE) {
    showPermissionToast("你没有权限清空记录，仅超级管理员可以操作。");
    return;
  }
  const confirmed = confirm("确定要清空所有加减分记录吗？\n\n此操作将删除全部加分/扣分记录，所有成员积分回到初始状态（基础分 85），且不可恢复。\n\n确定继续？");
  if (!confirmed) return;
  // 删除全部记录（id 自增从 1 起，neq id 0 为恒真条件；RLS 已授权超级管理员可删全部）
  const { data, error } = await cloud.database.from("scores").delete().neq("id", 0).select();
  if (error) { alert("清空失败：" + (error.message || "")); return; }
  const removed = Array.isArray(data) ? data.length : 0;
  showPermissionToast(`已清空 ${removed} 条记录，回到初始状态。`);
  await loadScores();
  updateActiveMemberMetric([]);
});

// ===== 活动提醒模块 =====
const REPEAT_LABELS = { none: "仅一次", monthly: "每月重复" };

// 当前用户是否管理员（可增删活动、设提醒时间）
let isActivityAdmin = false;

async function checkReminderPermission() {
  if (!cloud) return;
  const session = await cloud.auth.getSession();
  const btnAdd = document.getElementById("btn-add-activity");
  const hint = document.getElementById("reminder-permission-hint");
  if (!session.data) {
    isActivityAdmin = false;
    if (btnAdd) btnAdd.hidden = false; // 未登录也显示按钮，点击时提示需登录/无权限
    if (hint) hint.textContent = "（登录后可添加）";
    renderActivityAdminControls();
    return;
  }
  // 复用加减分模块的负责人判定逻辑（admins 白名单）
  let phone = session.data.user?.phone || "";
  if (!phone) {
    try {
      const u = await cloud.auth.getUser();
      phone = u.data?.phone || u.data?.email || "";
    } catch (e) {
      phone = "";
    }
  }
  phone = normalizePhone(phone);
  const { data } = await cloud.database.from("admins").select("phone");
  const admins = data || [];
  isActivityAdmin = admins.some((a) => normalizePhone(a.phone) === phone && phone !== "");
  if (btnAdd) btnAdd.hidden = false; // 始终显示，非管理员点击时弹权限提示
  if (hint) hint.textContent = isActivityAdmin ? "（你是管理员，可增删活动）" : "（只读，仅管理员可增删活动）";
  renderActivityAdminControls();
}

// 活动列表项里的操作按钮是否可见（增删/编辑仅管理员）
function renderActivityAdminControls() {
  document.querySelectorAll(".activity-item-actions").forEach((el) => {
    el.hidden = !isActivityAdmin;
  });
}

// 加载活动列表
async function loadActivities() {
  if (!cloud) return;
  const listEl = document.getElementById("activity-list");
  const emptyEl = document.getElementById("activity-empty");

  const { data, error } = await cloud.database
    .from("activities")
    .select("*")
    .order("remind_at", { ascending: true });

  if (error || !data || data.length === 0) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const now = new Date();
  listEl.innerHTML = data
    .map((a) => {
      const due = a.remind_at ? new Date(a.remind_at) : null;
      const overdue = due && due < now;
      const repeatTag = a.repeat_rule && a.repeat_rule !== "none"
        ? `<span class="activity-repeat-tag">${REPEAT_LABELS[a.repeat_rule] || a.repeat_rule}</span>`
        : "";
      return `
      <div class="activity-item ${overdue ? "overdue" : ""}" data-id="${a.id}">
        <div class="activity-icon"><i data-icon="bell"></i></div>
        <div class="activity-main">
          <div class="activity-title">${escapeHtml(a.title)}</div>
          <div class="activity-meta">${repeatTag}<span>${escapeHtml(a.owner_name || "")}</span></div>
          ${a.note ? `<div class="activity-note">${escapeHtml(a.note)}</div>` : ""}
        </div>
        <div class="activity-due">
          ${formatActivityTime(a.remind_at)}<small>提醒时间</small>
        </div>
        <div class="activity-item-actions">
          <button data-act="edit" data-id="${a.id}">编辑</button>
          <button data-act="del" data-id="${a.id}" class="del">删除</button>
        </div>
      </div>`;
    })
    .join("");

  listEl.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isActivityAdmin) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === "edit") {
        openActivityDialog(id);
      } else {
        if (!confirm("确定删除这个活动吗？")) return;
        const { error } = await cloud.database.from("activities").delete().eq("id", id);
        if (error) { alert("删除失败：" + (error.message || "")); return; }
        await loadActivities();
        updateReminderMetric();
      }
    });
  });

  renderActivityAdminControls();
  updateReminderMetric();
}

function formatActivityTime(iso) {
  if (!iso) return "未设置";
  const d = new Date(iso);
  if (isNaN(d)) return "未设置";
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${md} ${hm}`;
}

// 活动弹窗
const activityDialog = document.getElementById("activity-dialog");
let editingActivityId = null;

document.getElementById("btn-add-activity").addEventListener("click", () => {
  if (!isActivityAdmin) {
    showPermissionToast("你没有权限添加活动，仅负责人可以操作。");
    return;
  }
  editingActivityId = null;
  document.getElementById("activity-dialog-title").textContent = "添加活动";
  document.getElementById("activity-title").value = "";
  document.getElementById("activity-remind").value = "";
  document.getElementById("activity-repeat").value = "none";
  document.getElementById("activity-note").value = "";
  document.getElementById("activity-error").textContent = "";
  activityDialog.showModal();
});
document.getElementById("activity-close").addEventListener("click", () => activityDialog.close());

async function openActivityDialog(id) {
  editingActivityId = id;
  document.getElementById("activity-dialog-title").textContent = "编辑活动";
  const { data } = await cloud.database.from("activities").select("*").eq("id", id).maybeSingle();
  document.getElementById("activity-title").value = data?.title || "";
  document.getElementById("activity-remind").value = data?.remind_at ? toLocalInput(data.remind_at) : "";
  document.getElementById("activity-repeat").value = data?.repeat_rule || "none";
  document.getElementById("activity-note").value = data?.note || "";
  document.getElementById("activity-error").textContent = "";
  activityDialog.showModal();
}

// 把 ISO 时间转成 datetime-local 输入框的值（本地时区）
function toLocalInput(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

document.getElementById("activity-save").addEventListener("click", async () => {
  if (!cloud) { document.getElementById("activity-error").textContent = "服务未连接"; return; }
  if (!isActivityAdmin) { document.getElementById("activity-error").textContent = "仅管理员可操作"; return; }
  const title = document.getElementById("activity-title").value.trim();
  const remindLocal = document.getElementById("activity-remind").value;
  const repeatRule = document.getElementById("activity-repeat").value;
  const note = document.getElementById("activity-note").value.trim();
  const errEl = document.getElementById("activity-error");
  errEl.textContent = "";

  if (!title) { errEl.textContent = "请填写活动名称"; return; }
  if (!remindLocal) { errEl.textContent = "请选择提醒时间"; return; }
  // 转成 ISO 字符串（本地时区按北京时间处理）
  const remindAt = new Date(remindLocal).toISOString();

  const payload = {
    title,
    remind_at: remindAt,
    repeat_rule: repeatRule,
    note: note || null,
  };

  if (editingActivityId) {
    const { error } = await cloud.database.from("activities").update(payload).eq("id", editingActivityId);
    if (error) { errEl.textContent = "保存失败：" + (error.message || ""); return; }
  } else {
    const session = await cloud.auth.getSession();
    payload.owner_name = session.data?.user?.name || null;
    const { error } = await cloud.database.from("activities").insert(payload);
    if (error) { errEl.textContent = "保存失败：" + (error.message || ""); return; }
  }
  activityDialog.close();
  await loadActivities();
});

// 概览页「即将到来的活动」指标
function updateReminderMetric() {
  const el = document.getElementById("metric-reminders");
  if (!el || !cloud) return;
  cloud.database.from("activities").select("id, remind_at").then(({ data }) => {
    const now = new Date();
    const upcoming = (data || []).filter((a) => a.remind_at && new Date(a.remind_at) >= now).length;
    el.textContent = upcoming;
  }).catch(() => {});
}

// 概览页「公文模板」指标（主题数量）
function updateTemplateMetric() {
  const el = document.getElementById("metric-templates");
  if (!el || !cloud) return;
  cloud.database.from("template_groups").select("id").then(({ data, error }) => {
    if (error) return;
    el.textContent = (data || []).length;
  }).catch(() => {});
}

// 概览页「活跃成员」指标（本月有过加减分记录的成员数）
function updateActiveMemberMetricFromDb() {
  const el = document.getElementById("metric-members");
  if (!el || !cloud) return;
  cloud.database.from("scores").select("member, created_at").then(({ data }) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeSet = new Set();
    (data || []).forEach((s) => {
      const d = new Date(s.created_at);
      if (d >= monthStart) activeSet.add(s.member);
    });
    el.textContent = activeSet.size;
  }).catch(() => {});
}

// 打开网页时检测到点活动，弹提醒
let reminderNotified = new Set();
async function checkDueReminders() {
  if (!cloud) return;
  const session = await cloud.auth.getSession();
  if (!session.data) return; // 未登录不弹
  const { data } = await cloud.database.from("activities").select("id, title, remind_at").order("remind_at", { ascending: true });
  if (!data || data.length === 0) return;
  const now = new Date();
  const due = data.filter((a) => {
    if (!a.remind_at) return false;
    const t = new Date(a.remind_at);
    // 已到提醒时间，且不超过提醒时间后 1 小时（避免一整天都反复提醒），且本次会话未提醒过
    return t <= now && (now - t) < 60 * 60 * 1000 && !reminderNotified.has(a.id);
  });
  if (due.length === 0) return;
  due.forEach((a) => reminderNotified.add(a.id));
  const names = due.map((a) => a.title).join("、");
  alert(`⏰ 活动提醒\n\n以下活动已到提醒时间：\n${names}`);
}

// ===== 橡皮筋分段选择器（RubberSegment 原生移植） =====
// 为 #view-templates 与 #view-scores 的 .sub-tabs 注入滑块层，
// 复用现有 .sub-tab 的 click/data-subtab 逻辑，只增强视觉与拖拽手感。
function initRubberSegments() {
  const groups = document.querySelectorAll("#view-templates .sub-tabs, #view-scores .sub-tabs");
  groups.forEach((track) => {
    if (track.classList.contains("rs-enabled")) return;
    track.classList.add("rs-enabled");

    const tabs = Array.from(track.querySelectorAll(":scope > .sub-tab"));
    if (tabs.length < 2) return;

    // 读取轨道内边距（CSS padding: 4px）
    const cs = getComputedStyle(track);
    const pad = parseFloat(cs.paddingTop) || 4;
    const inset = pad;

    // 构建滑块层 + 副本按钮（反色）
    const thumb = document.createElement("div");
    thumb.className = "rs-thumb";
    thumb.setAttribute("aria-hidden", "true");
    tabs.forEach((t) => {
      const copy = document.createElement("span");
      copy.className = "sub-tab-copy";
      copy.innerHTML = t.innerHTML; // 复制图标 + 文字
      thumb.appendChild(copy);
    });
    track.appendChild(thumb);

    // 状态
    let slots = [];        // 每个 tab 的 {l, r}（相对轨道内容，不含 inset）
    let edgeL = 0;         // 滑块左边缘（相对内容区，含 inset 计算）
    let edgeR = 0;
    let committed = Math.max(0, tabs.findIndex((t) => t.classList.contains("active")));
    let dragging = false;
    let onThumb = false;
    let downX = 0;
    let grabOffset = 0;
    let thumbW = 0;
    let live = false;
    let hist = [];         // [[time, x], ...]
    let animId = null;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const RUBBER = 0.55;
    const DEADZONE = 4;
    const SLOP = 10;
    const FLICK = 110;
    const MAX_V = 2000;

    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const rubber = (over, dim) => (over * dim * RUBBER) / (dim + RUBBER * Math.abs(over));

    const measure = () => {
      // 轨道不可见（hidden 或被折叠）时跳过，等待可见后由 ResizeObserver/remeasure 触发
      if (!track.clientWidth) return;
      const rect = track.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(track).paddingLeft) || inset;
      slots = tabs.map((t) => {
        const r = t.getBoundingClientRect();
        return { l: r.left - rect.left - padL, r: r.right - rect.left - padL };
      });
      // 对齐副本按钮位置与宽度
      thumb.querySelectorAll(".sub-tab-copy").forEach((copy, i) => {
        const s = slots[i];
        if (!s) return;
        copy.style.left = `${s.l}px`;
        copy.style.width = `${s.r - s.l}px`;
      });
      applyClip();
    };

    const applyClip = () => {
      const innerW = track.clientWidth - inset * 2;
      const l = clamp(edgeL, 0, innerW);
      const r = clamp(edgeR, 0, innerW);
      const rr = Math.max(0, innerW - r);
      const ll = Math.max(0, l);
      const rad = 18;
      thumb.style.clipPath = `inset(0 ${rr}px 0 ${ll}px round ${rad}px)`;
    };

    // 立即跳转到槽位 i
    const jumpTo = (i) => {
      const s = slots[i];
      if (!s) return;
      edgeL = s.l;
      edgeR = s.r;
      applyClip();
    };

    // 弹簧动画到目标槽位
    const springTo = (i, opts = {}) => {
      const s = slots[i];
      if (!s) return;
      if (reduceMotion) { jumpTo(i); return; }
      cancelAnim();
      const fromL = edgeL, fromR = edgeR;
      const toL = s.l, toR = s.r;
      const start = performance.now();
      // 阻尼弹簧：zeta=1 临界阻尼（平滑无过冲，一次到位）
      const dur = opts.momentum ? 360 : 320;
      const omega = 2 * Math.PI / (dur / 1000); // 固有频率
      const zeta = 1.0; // 临界阻尼：无过冲、无回弹
      const wd = omega * Math.sqrt(1 - zeta * zeta);
      const alpha = zeta * omega;

      const step = (now) => {
        const t = (now - start) / 1000;
        const T = dur / 1000;
        if (t >= T) {
          edgeL = toL; edgeR = toR;
          applyClip();
          return;
        }
        let k;
        if (zeta === 1) {
          // 临界阻尼：x(t) = 1 - e^(-ωt)(1 + ωt)
          k = 1 - Math.exp(-omega * t) * (1 + omega * t);
        } else {
          const decay = Math.exp(-alpha * t);
          const osc = Math.cos(wd * t) + (alpha / wd) * Math.sin(wd * t);
          k = 1 - decay * osc;
        }
        edgeL = fromL + (toL - fromL) * k;
        edgeR = fromR + (toR - fromR) * k;
        applyClip();
        animId = requestAnimationFrame(step);
      };
      animId = requestAnimationFrame(step);
    };

    const cancelAnim = () => { if (animId) { cancelAnimationFrame(animId); animId = null; } };

    const commit = (i) => {
      if (i < 0 || i >= tabs.length) return;
      // 先触发 click（切换 active），再更新 committed；
      // 这样 MutationObserver 能检测到 committed 与 active 的差异并触发动画
      if (!tabs[i].classList.contains("active")) {
        tabs[i].click(); // 触发原有切换逻辑（后续由 MutationObserver 统一动画）
      }
      committed = i;
    };

    const nearestSlot = (x) => {
      let best = committed;
      for (let i = 0; i < slots.length; i++) {
        const cx = (slots[i].l + slots[i].r) / 2;
        const bx = (slots[best].l + slots[best].r) / 2;
        if (Math.abs(cx - x) < Math.abs(bx - x)) best = i;
      }
      return best;
    };

    const velocityOf = (h, now) => {
      const recent = h.filter(([t]) => now - t <= 100);
      if (recent.length < 2) return 0;
      const [t0, x0] = recent[0];
      const [t1, x1] = recent[recent.length - 1];
      return t1 - t0 >= 8 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
    };

    const project = (v) => {
      const d = 1 - 0.1 * Math.pow(0.05, 75 / 100);
      return ((v / 1000) * d) / (1 - d);
    };

    const localX = (e) => {
      const rect = track.getBoundingClientRect();
      const padL = parseFloat(getComputedStyle(track).paddingLeft) || inset;
      return e.clientX - rect.left - padL;
    };

    const release = () => {
      dragging = false;
      track.classList.remove("rs-dragging");
      return { onThumb, live, downX };
    };

    // 指针事件：在 track 上监听，覆盖按钮点击
    const onDown = (e) => {
      if (e.button !== 0) return;
      // 命中测试：是否落在滑块上
      const x = localX(e);
      onThumb = x >= edgeL && x <= edgeR;
      dragging = true;
      live = false;
      downX = x;
      grabOffset = onThumb ? x - edgeL : 0;
      thumbW = edgeR - edgeL;
      hist = [[e.timeStamp, x]];
      if (onThumb) {
        cancelAnim();
        track.classList.add("rs-dragging");
      }
    };

    const onMove = (e) => {
      if (!dragging) return;
      const x = localX(e);
      if (!onThumb) return;
      hist.push([e.timeStamp, x]);
      if (hist.length > 8) hist.shift();
      if (!live) {
        if (Math.abs(x - downX) < DEADZONE) return;
        live = true;
        track.classList.add("rs-dragging");
      }
      const innerW = track.clientWidth - inset * 2;
      const l = x - grabOffset;
      const maxL = innerW - thumbW;
      if (reduceMotion) {
        edgeL = clamp(l, 0, maxL);
        edgeR = edgeL + thumbW;
      } else if (l < 0) {
        edgeL = 0;
        edgeR = thumbW - rubber(-l, thumbW);
      } else if (l > maxL) {
        edgeR = innerW;
        edgeL = maxL + rubber(l - maxL, thumbW);
      } else {
        edgeL = l;
        edgeR = l + thumbW;
      }
      applyClip();
    };

    const onUp = (e) => {
      if (!dragging) return;
      const wasThumb = onThumb, wasLive = live;
      const x = localX(e);
      release();
      if (!wasThumb) return; // 点击未选中项：交给原生 click + MutationObserver 动画
      if (!wasLive) {
        // 点击滑块上的选中项：无切换，仅吸附回原位
        if (slots.length) jumpTo(committed);
        return;
      }
      // 拖拽松手：计算落点，由 onUp 自己负责动画（MutationObserver 检测不到差异）
      const v = velocityOf(hist, e.timeStamp);
      const flick = Math.abs(v) > FLICK;
      let to = nearestSlot((edgeL + edgeR) / 2 + project(v));
      if (flick && to === committed) to = clamp(to + Math.sign(v), 0, tabs.length - 1);
      commit(to);
      if (reduceMotion) jumpTo(to);
      else springTo(to, { momentum: flick });
    };

    const onCancel = () => {
      if (!dragging) return;
      release();
      springTo(committed, { squash: false });
    };

    track.addEventListener("pointerdown", onDown);
    track.addEventListener("pointermove", onMove);
    track.addEventListener("pointerup", onUp);
    track.addEventListener("pointercancel", onCancel);

    // 用 MutationObserver 监听 active 类变化（外部代码/键盘切换时同步滑块）
    const syncObserver = new MutationObserver(() => {
      const idx = tabs.findIndex((t) => t.classList.contains("active"));
      if (idx >= 0 && idx !== committed && !dragging) {
        committed = idx;
        if (slots.length) springTo(idx, { squash: false });
      }
    });
    tabs.forEach((t) => syncObserver.observe(t, { attributes: true, attributeFilter: ["class"] }));

    // 初始定位 + 尺寸变化重测量
    const doInit = () => {
      measure();
      if (slots.length) jumpTo(committed);
    };
    requestAnimationFrame(() => {
      doInit();
      requestAnimationFrame(doInit); // 二次确认，避免字体/布局未就绪
    });

    // 轨道尺寸变化（含 hidden→visible）时重测量
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        measure();
        if (slots.length && !dragging) jumpTo(committed);
      });
      ro.observe(track);
    }
    window.addEventListener("resize", doInit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(doInit);

    // 注册到全局 remeasure 列表，供视图切换时调用
    if (!window.__rsRemeasurers) window.__rsRemeasurers = [];
    window.__rsRemeasurers.push(() => {
      measure();
      if (slots.length && !dragging) jumpTo(committed);
    });
  });
}

// 供 switchView 调用的全局重测量入口
function remeasureRubberSegments() {
  if (window.__rsRemeasurers) window.__rsRemeasurers.forEach((fn) => fn());
}

// ===== 光晕卡片（BorderGlow 原生移植） =====
// 为概览页三个 .metric 卡片注入鼠标跟随的光晕描边 + 柔光效果。
function initBorderGlow() {
  const cards = document.querySelectorAll("#view-overview .metric");
  // 三个卡片分别用项目主题色：蓝 / 绿 / 琥珀
  const colorMap = ["214 100% 44%", "165 56% 33%", "38 51% 42%"];
  cards.forEach((card, idx) => {
    if (card.classList.contains("bg-glow")) return;
    card.classList.add("bg-glow");
    card.style.setProperty("--glow-color", colorMap[idx] || colorMap[0]);
    card.style.setProperty("--glow-op", "0");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 鼠标移入：渐显光晕
    card.addEventListener("pointerenter", () => {
      if (reduceMotion) return;
      card.style.setProperty("--glow-op", "1");
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--glow-op", "0");
    });

    // 鼠标移动：计算角度 + 边缘接近度 + 光斑位置
    card.addEventListener("pointermove", (e) => {
      if (reduceMotion) return;
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // 角度：相对卡片中心，+90° 让高光指向鼠标方向
      const dx = x - cx;
      const dy = y - cy;
      const radians = Math.atan2(dy, dx);
      let angle = radians * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      card.style.setProperty("--glow-angle", `${angle}deg`);

      // 边缘接近度：鼠标越靠边越强（0=中心，1=边缘）
      let kx = Infinity, ky = Infinity;
      if (dx !== 0) kx = cx / Math.abs(dx);
      if (dy !== 0) ky = cy / Math.abs(dy);
      const prox = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
      card.style.setProperty("--glow-prox", prox.toFixed(3));

      // 柔光光斑位置
      card.style.setProperty("--glow-x", `${(x / rect.width) * 100}%`);
      card.style.setProperty("--glow-y", `${(y / rect.height) * 100}%`);
    });
  });
}

// ===== SpecularButton 流光按钮（原生 JS 移植自 React WebGL2 组件）=====
(function initSpecularLoginButton() {
  const PAD = 24;
  const TAU = Math.PI * 2;

  const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

  const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}

float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`;

  const UNIFORMS = [
    "uCenter", "uHalf", "uRadius", "uPx", "uSpot", "uEntry",
    "uLineColor", "uBaseColor", "uIntensity", "uWindow", "uThickness", "uGlow"
  ];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const wrap = v => v - Math.floor(v);

  const loopPosition = (x, y, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const qx = ax - innerX;
    const qy = ay - innerY;
    let s;
    if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
    else if (qx > qy) s = Math.min(ay, innerY);
    else s = innerY + arc + innerX - Math.min(ax, innerX);
    if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
    else if (y < 0) s = 4 * quarter - s;
    return wrap(s / Math.max(4 * quarter, 0.0001));
  };

  const rimPoint = (position, halfX, halfY, r) => {
    const innerX = halfX - r;
    const innerY = halfY - r;
    const arc = (Math.PI / 2) * r;
    const quarter = innerX + innerY + arc;
    let s = wrap(position) * 4 * quarter;
    let signX = 1;
    let signY = 1;
    if (s > 3 * quarter) {
      s = 4 * quarter - s;
      signY = -1;
    } else if (s > 2 * quarter) {
      s -= 2 * quarter;
      signX = -1;
      signY = -1;
    } else if (s > quarter) {
      s = 2 * quarter - s;
      signX = -1;
    }
    let x = innerX - (s - innerY - arc);
    let y = halfY;
    if (s <= innerY) {
      x = halfX;
      y = s;
    } else if (s <= innerY + arc) {
      const angle = (s - innerY) / Math.max(r, 0.0001);
      x = innerX + Math.cos(angle) * r;
      y = innerY + Math.sin(angle) * r;
    }
    return [x * signX, y * signY];
  };

  const compile = (gl, type, source) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  const link = gl => {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, "aPosition");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
    gl.deleteProgram(program);
    return null;
  };

  function mount() {
    const button = document.getElementById("login-btn");
    const canvas = button?.querySelector(".specular-login-btn__light");
    if (!button || !canvas) return false;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false
    });
    if (!gl) return false;
    const program = link(gl);
    if (!program) return false;

    // 淡雅配色：浅青灰线条，适配当前简约浅色主题
    const settings = {
      radius: 20,
      lineColor: "#6fa6a6",
      baseColor: "#d8e4e4",
      intensity: 1,
      idleIntensity: 0.35,
      shineSize: 10,
      shineFade: 34,
      thickness: 1.2,
      glow: 1,
      speed: 0.35,
      followMouse: true,
      proximity: 250,
      autoAnimate: false
    };

    const uniforms = {};
    for (const name of UNIFORMS) uniforms[name] = gl.getUniformLocation(program, name);
    const buffer = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const colors = new Map();
    const view = { width: 1, height: 1, ratio: 1 };
    const pointer = { x: 0, y: 0, known: false };
    const state = { spot: 0, level: 0, press: 0, ready: false };
    let raf = 0;
    let last = 0;
    let visible = true;

    const toRgb = value => {
      if (colors.has(value)) return colors.get(value);
      let rgb = [1, 1, 1];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = "#000000";
        probe.fillStyle = value;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        rgb = [r / 255, g / 255, b / 255];
      }
      colors.set(value, rgb);
      return rgb;
    };

    const cornerRadius = () => Math.min(settings.radius, view.width / 2, view.height / 2);

    const restSpot = () => {
      const r = cornerRadius();
      const inset = r * (1 - Math.SQRT1_2);
      return loopPosition(inset - view.width / 2, view.height / 2 - inset, view.width / 2, view.height / 2, r);
    };

    const aim = () => {
      if (!settings.followMouse || !pointer.known) return null;
      const rect = button.getBoundingClientRect();
      const scale = rect.width / view.width || 1;
      const halfX = view.width / 2;
      const halfY = view.height / 2;
      const x = (pointer.x - rect.left - rect.width / 2) / scale;
      const y = (rect.top + rect.height / 2 - pointer.y) / scale;
      const distance = Math.hypot(Math.max(Math.abs(x) - halfX, 0), Math.max(Math.abs(y) - halfY, 0));
      const t = clamp(1 - distance / settings.proximity, 0, 1);
      const near = t * t * (3 - 2 * t);
      const nearest = loopPosition(x, y, halfX, halfY, cornerRadius());
      if (distance > 0) return { spot: nearest, near };
      const depth = clamp(Math.min(halfX - Math.abs(x), halfY - Math.abs(y)) / (halfY * 0.8), 0, 1);
      const sway = restSpot() - (x / halfX) * 0.06 - (y / halfY) * 0.02;
      const offset = sway - nearest - Math.round(sway - nearest);
      return { spot: wrap(nearest + offset * depth * depth * (3 - 2 * depth)), near };
    };

    const draw = () => {
      const { width, height } = view;
      const scaleX = canvas.width / (width + PAD * 2);
      const scaleY = canvas.height / (height + PAD * 2);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uCenter, (PAD + width / 2) * scaleX, (PAD + height / 2) * scaleY);
      gl.uniform2f(uniforms.uHalf, (width / 2) * scaleX, (height / 2) * scaleY);
      gl.uniform1f(uniforms.uRadius, Math.min(settings.radius, width / 2, height / 2) * scaleX);
      gl.uniform1f(uniforms.uPx, view.ratio);
      const r = Math.min(settings.radius, width / 2, height / 2);
      const [rimX, rimY] = rimPoint(state.spot, width / 2, height / 2, r);
      const pull = 1 - Math.min(0.35 * (height / 2), Math.hypot(rimX, rimY)) / Math.max(Math.hypot(rimX, rimY), 0.0001);
      gl.uniform1f(uniforms.uSpot, state.spot);
      gl.uniform2f(uniforms.uEntry, rimX * pull * scaleX, rimY * pull * scaleY);
      gl.uniform3fv(uniforms.uLineColor, toRgb(settings.lineColor));
      gl.uniform3fv(uniforms.uBaseColor, toRgb(settings.baseColor));
      gl.uniform1f(uniforms.uIntensity, settings.intensity * (state.level + state.press * 0.8));
      gl.uniform2f(uniforms.uWindow, settings.shineSize / 360 + state.press * 0.06, settings.shineFade / 360 + 0.0001);
      gl.uniform1f(uniforms.uThickness, settings.thickness);
      gl.uniform1f(uniforms.uGlow, settings.glow);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    };

    const frame = now => {
      raf = 0;
      if (!visible) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const target = aim();
      const spinning = settings.autoAnimate && !reduce;
      const steering = !!target && target.near > 0;
      if (!state.ready) {
        state.spot = restSpot();
        state.level = settings.autoAnimate ? 1 : settings.idleIntensity;
        state.ready = true;
      }
      let diff = 0;
      if (spinning && !steering) {
        state.spot = wrap(state.spot + (settings.speed / TAU) * dt);
      } else {
        diff = (steering ? target.spot : restSpot()) - state.spot;
        diff -= Math.round(diff);
        state.spot = wrap(state.spot + diff * (1 - Math.exp(-dt * 8)));
      }
      const level = settings.autoAnimate ? 1 : settings.idleIntensity + (1 - settings.idleIntensity) * (target ? target.near : 0);
      state.level += (level - state.level) * (1 - Math.exp(-dt * 7));
      state.press *= Math.exp(-dt * 5);
      draw();
      const settling = Math.abs(diff) > 0.0002 || Math.abs(level - state.level) > 0.001 || state.press > 0.002;
      if (settling || (spinning && !steering)) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    const wake = () => {
      if (!raf && visible) raf = requestAnimationFrame(frame);
    };

    const measure = () => {
      view.width = Math.max(1, button.offsetWidth);
      view.height = Math.max(1, button.offsetHeight);
      view.ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.max(1, Math.round((view.width + PAD * 2) * view.ratio));
      canvas.height = Math.max(1, Math.round((view.height + PAD * 2) * view.ratio));
      if (state.ready) draw();
      wake();
    };

    const onPointerMove = event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.known = true;
      wake();
    };

    const onPointerDown = event => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.known = true;
      state.press = 1;
      wake();
    };

    const onPointerEnd = event => {
      if (event.pointerType === "mouse") return;
      pointer.known = false;
      wake();
    };

    const onPointerLeave = () => {
      pointer.known = false;
      wake();
    };

    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(button);
    const intersection = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) {
        last = 0;
        wake();
      }
    });
    intersection.observe(button);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    button.addEventListener("pointerdown", onPointerDown);
    measure();

    // 登录状态切换后按钮可能隐藏/显示，用观察器在重新可见时重测
    const stateObserver = new MutationObserver(() => {
      if (!button.hidden) {
        last = 0;
        measure();
      }
    });
    stateObserver.observe(button, { attributes: true, attributeFilter: ["hidden"] });

    return true;
  }

  // DOM 就绪后挂载（bootstrap 里也会调用 refreshUser，故在此直接初始化）
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mount());
  } else {
    mount();
  }
})();

document.addEventListener("DOMContentLoaded", bootstrap);

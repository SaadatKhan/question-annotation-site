(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const api = window.AnnotationApi;
  const form = document.getElementById("login-form");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const rememberInput = document.getElementById("remember-login");
  const loginButton = document.getElementById("login-button");
  const status = document.getElementById("login-status");
  const togglePasswordButton = document.getElementById("toggle-password");
  const forgetLoginButton = document.getElementById("forget-login");

  document.title = config.appTitle;
  document.getElementById("login-title").textContent = config.appTitle;

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ""}`;
  }

  function refreshSavedState() {
    forgetLoginButton.classList.toggle("hidden", !api.getStoredToken());
  }

  togglePasswordButton.addEventListener("click", () => {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    togglePasswordButton.textContent = shouldShow ? "Hide" : "Show";
    togglePasswordButton.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
    togglePasswordButton.title = shouldShow ? "Hide password" : "Show password";
  });

  forgetLoginButton.addEventListener("click", () => {
    api.clearSession();
    setStatus("Saved login removed.", "success");
    refreshSavedState();
    usernameInput.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      setStatus("Enter your username and password.", "error");
      (!username ? usernameInput : passwordInput).focus();
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    setStatus("Checking your account...");

    try {
      const result = await api.login(username, password);
      api.storeToken(result.token, rememberInput.checked);
      sessionStorage.setItem(config.currentUserStorageKey, JSON.stringify(result.user));
      window.location.assign(result.user.role === "admin" ? "admin.html" : "annotate.html");
    } catch (error) {
      setStatus(error.message || "Sign in failed.", "error");
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  });

  async function resumeSession() {
    refreshSavedState();
    if (!api.getStoredToken()) return;
    try {
      const result = await api.getSession();
      sessionStorage.setItem(config.currentUserStorageKey, JSON.stringify(result.user));
      setStatus(`A saved login is available for ${result.user.displayName}.`, "success");
    } catch {
      api.clearSession();
      refreshSavedState();
    }
  }

  resumeSession();
})();

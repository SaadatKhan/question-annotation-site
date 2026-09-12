(function () {
  "use strict";

  const config = window.APP_CONFIG;
  const client = window.GitHubClient;
  const form = document.getElementById("login-form");
  const tokenInput = document.getElementById("token");
  const rememberInput = document.getElementById("remember-token");
  const loginButton = document.getElementById("login-button");
  const status = document.getElementById("login-status");
  const toggleTokenButton = document.getElementById("toggle-token");
  const forgetTokenButton = document.getElementById("forget-token");

  document.title = config.appTitle;
  document.getElementById("login-title").textContent = config.appTitle;

  function approvedUsername(githubLogin) {
    return Object.keys(window.ANNOTATION_USERS).find(
      (username) => username.toLowerCase() === githubLogin.toLowerCase()
    ) || null;
  }

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `status${type ? ` ${type}` : ""}`;
  }

  function refreshSavedTokenState() {
    const hasSavedToken = Boolean(client.getStoredToken());
    forgetTokenButton.classList.toggle("hidden", !hasSavedToken);
    tokenInput.placeholder = hasSavedToken ? "Saved token available" : "github_pat_...";
  }

  toggleTokenButton.addEventListener("click", () => {
    const shouldShow = tokenInput.type === "password";
    tokenInput.type = shouldShow ? "text" : "password";
    toggleTokenButton.textContent = shouldShow ? "Hide" : "Show";
    toggleTokenButton.setAttribute("aria-label", shouldShow ? "Hide token" : "Show token");
    toggleTokenButton.title = shouldShow ? "Hide token" : "Show token";
  });

  forgetTokenButton.addEventListener("click", () => {
    client.clearToken();
    sessionStorage.removeItem(config.currentUserStorageKey);
    tokenInput.value = "";
    setStatus("Saved token removed.", "success");
    refreshSavedTokenState();
    tokenInput.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const enteredToken = tokenInput.value.trim();
    const token = enteredToken || client.getStoredToken();
    if (!token) {
      setStatus("Enter a GitHub access token.", "error");
      tokenInput.focus();
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Checking access...";
    setStatus("Connecting securely to GitHub...");

    try {
      const githubUser = await client.verifyAccess(token);
      const username = approvedUsername(githubUser.login);
      if (!username) {
        throw new Error(`GitHub account ${githubUser.login} is not on the approved annotator list.`);
      }

      client.storeToken(token, rememberInput.checked);
      sessionStorage.setItem(config.currentUserStorageKey, username);
      setStatus(`Connected as ${githubUser.login}.`, "success");
      window.location.assign("annotate.html");
    } catch (error) {
      let message = error.message || "GitHub access could not be verified.";
      if (error instanceof client.GitHubApiError) {
        if (error.status === 401) message = "The token is invalid or expired.";
        if (error.status === 403) message = "The token does not have permission to access the results repository.";
        if (error.status === 404) message = "The private results repository is unavailable to this token.";
      }
      setStatus(message, "error");
      loginButton.disabled = false;
      loginButton.textContent = "Connect to GitHub";
    }
  });

  refreshSavedTokenState();
})();

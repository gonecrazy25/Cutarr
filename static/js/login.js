let needsSetup = false;

const subtitle = document.getElementById("loginSubtitle");
const form = document.getElementById("loginForm");
const passwordInput = document.getElementById("loginPassword");
const confirmLabel = document.getElementById("confirmPasswordLabel");
const confirmInput = document.getElementById("confirmSetupPassword");
const submitButton = document.getElementById("loginSubmit");
const message = document.getElementById("loginMessage");
const passwordLabel = document.getElementById("loginPasswordLabel");

async function checkStatus() {
  try {
    const res = await fetch("/api/auth/status", {cache: "no-store"});
    const data = await res.json();

    if (data.authenticated) {
      window.location.href = "/";
      return;
    }

    needsSetup = Boolean(data.needs_setup);

    if (needsSetup) {
      subtitle.textContent = "First-time setup: create the admin password.";
      passwordLabel.textContent = "New admin password";
      passwordInput.setAttribute("autocomplete", "new-password");
      confirmLabel.classList.remove("hidden");
      confirmInput.classList.remove("hidden");
      submitButton.textContent = "Set Admin Password";
    } else {
      subtitle.textContent = "Login as admin.";
      passwordLabel.textContent = "Password";
      passwordInput.setAttribute("autocomplete", "current-password");
      confirmLabel.classList.add("hidden");
      confirmInput.classList.add("hidden");
      submitButton.textContent = "Login";
    }
  } catch (err) {
    subtitle.textContent = "Could not check login status.";
    message.textContent = "Refresh the page or check the Cutarr container logs.";
    console.error(err);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";

  const password = passwordInput.value || "";

  if (needsSetup) {
    const confirm = confirmInput.value || "";

    if (password.length < 6) {
      message.textContent = "Password must be at least 6 characters long.";
      return;
    }

    if (password !== confirm) {
      message.textContent = "Passwords do not match.";
      return;
    }
  }

  try {
    submitButton.disabled = true;
    submitButton.textContent = needsSetup ? "Saving..." : "Logging in...";

    const endpoint = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({password})
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || "Login failed.");
    }

    window.location.href = "/";
  } catch (err) {
    message.textContent = err.message || "Login failed.";
    submitButton.disabled = false;
    submitButton.textContent = needsSetup ? "Set Admin Password" : "Login";
  }
});

checkStatus();

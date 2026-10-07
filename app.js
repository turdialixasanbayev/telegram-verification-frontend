(() => {
    "use strict";

    // Backend manzili. Frontend Django bilan bir domenda bo'lsa, nisbiy yo'l yetarli.
    // Boshqa domenda bo'lsa, masalan: "https://api.example.com/api/v1/auth"
    // (u holda backendda CORS va CSRF_TRUSTED_ORIGINS sozlanishi kerak).
    const API_BASE = "http://127.0.0.1:8000/api/v1/auth";

    // Faqat interfeys uchun: "qayta yuborish" tugmasi qancha vaqt o'chiq turadi.
    const RESEND_COOLDOWN_SECONDS = 60;

    const STORAGE_KEY = "tv_request_id";

    const FIELD_LABELS = {
        phone_number: "Telefon raqami",
        password: "Parol",
        code: "Kod",
        request_id: "So'rov",
    };

    const $ = (selector) => document.querySelector(selector);

    const els = {
        message: $("#message"),
        views: document.querySelectorAll("[data-view]"),
        viewAuth: $("#view-auth"),
        viewVerify: $("#view-verify"),
        viewDone: $("#view-done"),
        tabLogin: $("#tab-login"),
        tabRegister: $("#tab-register"),
        formLogin: $("#form-login"),
        formRegister: $("#form-register"),
        formVerify: $("#form-verify"),
        code: $("#verify-code"),
        resendBtn: $("#resend-btn"),
        backBtn: $("#back-btn"),
        doneTitle: $("#done-title"),
        doneText: $("#done-text"),
        doneBtn: $("#done-btn"),
    };

    let requestId = sessionStorage.getItem(STORAGE_KEY);
    let resendTimer = null;

    /* ---------- API ---------- */

    class ApiError extends Error {
        constructor(status, data) {
            super(`API error ${status}`);
            this.status = status;
            this.data = data;
        }
    }

    function getCookie(name) {
        const pair = document.cookie
            .split("; ")
            .find((row) => row.startsWith(`${name}=`));
        return pair ? decodeURIComponent(pair.split("=").slice(1).join("=")) : null;
    }

    async function post(path, payload) {
        const headers = { "Content-Type": "application/json", Accept: "application/json" };
        const csrfToken = getCookie("csrftoken");
        if (csrfToken) {
            headers["X-CSRFToken"] = csrfToken;
        }

        let response;
        try {
            response = await fetch(`${API_BASE}${path}`, {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify(payload),
            });
        } catch {
            throw new ApiError(0, { detail: "Serverga ulanib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring." });
        }

        let data = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            throw new ApiError(response.status, data);
        }
        return data;
    }

    /* ---------- UI helpers ---------- */

    function showView(view) {
        els.views.forEach((section) => {
            section.hidden = section !== view;
        });
        hideMessage();
        clearFieldErrors();
    }

    function showMessage(text, type) {
        els.message.textContent = text;
        els.message.className = `message message--${type}`;
        els.message.hidden = false;
    }

    function hideMessage() {
        els.message.hidden = true;
        els.message.textContent = "";
    }

    function clearFieldErrors() {
        document.querySelectorAll("[data-error-for]").forEach((node) => {
            node.textContent = "";
        });
        document.querySelectorAll("input[aria-invalid]").forEach((input) => {
            input.removeAttribute("aria-invalid");
        });
    }

    function setBusy(form, busy) {
        form.querySelectorAll("button, input").forEach((control) => {
            control.disabled = busy;
        });
    }

    function toList(value) {
        return Array.isArray(value) ? value : [String(value)];
    }

    // DRF xato javobini ({field: [..]}, {detail: ".."}, non_field_errors) ko'rsatadi.
    function renderErrors(error, form) {
        clearFieldErrors();
        const data = error instanceof ApiError ? error.data : null;

        if (!data || typeof data !== "object") {
            showMessage(
                error instanceof ApiError && error.status >= 500
                    ? "Serverda xatolik yuz berdi. Birozdan keyin qayta urinib ko'ring."
                    : `Server kutilmagan javob qaytardi (HTTP ${error instanceof ApiError ? error.status : "?"}). API_BASE manzilini tekshiring.`,
                "error"
            );
            return;
        }

        const general = [];
        Object.entries(data).forEach(([key, value]) => {
            const target = form && form.querySelector(`[data-error-for="${key}"]`);
            if (target) {
                target.textContent = toList(value).join(" ");
                const input = form.querySelector(`[name="${key}"]`);
                if (input) input.setAttribute("aria-invalid", "true");
            } else if (key === "detail" || key === "non_field_errors") {
                general.push(...toList(value));
            } else {
                general.push(`${FIELD_LABELS[key] || key}: ${toList(value).join(" ")}`);
            }
        });

        if (error.status === 429) {
            general.unshift("Juda ko'p urinish. Biroz kutib, qayta urinib ko'ring.");
        }
        if (general.length) {
            showMessage(general.join(" "), "error");
        }
    }

    /* ---------- Tabs ---------- */

    function selectTab(name) {
        const isLogin = name === "login";
        els.tabLogin.classList.toggle("is-active", isLogin);
        els.tabRegister.classList.toggle("is-active", !isLogin);
        els.tabLogin.setAttribute("aria-selected", String(isLogin));
        els.tabRegister.setAttribute("aria-selected", String(!isLogin));
        els.formLogin.hidden = !isLogin;
        els.formRegister.hidden = isLogin;
        hideMessage();
        clearFieldErrors();
    }

    /* ---------- Verify step ---------- */

    function goToVerify(id) {
        requestId = id;
        sessionStorage.setItem(STORAGE_KEY, id);
        showView(els.viewVerify);
        els.code.value = "";
        els.code.focus();
        startResendCooldown();
    }

    function leaveVerify() {
        requestId = null;
        sessionStorage.removeItem(STORAGE_KEY);
        stopResendCooldown();
        showView(els.viewAuth);
    }

    function startResendCooldown() {
        stopResendCooldown();
        let remaining = RESEND_COOLDOWN_SECONDS;
        els.resendBtn.disabled = true;

        const tick = () => {
            if (remaining <= 0) {
                stopResendCooldown();
                return;
            }
            els.resendBtn.textContent = `Kodni qayta yuborish (${remaining} s)`;
            remaining -= 1;
        };
        tick();
        resendTimer = setInterval(tick, 1000);
    }

    function stopResendCooldown() {
        clearInterval(resendTimer);
        resendTimer = null;
        els.resendBtn.disabled = false;
        els.resendBtn.textContent = "Kodni qayta yuborish";
    }

    function showDone(title, text) {
        showView(els.viewDone);
        els.doneTitle.textContent = title;
        els.doneText.textContent = text;
    }

    /* ---------- Handlers ---------- */

    function formPayload(form) {
        return Object.fromEntries(new FormData(form).entries());
    }

    async function handleRegister(event) {
        event.preventDefault();
        const form = event.currentTarget;
        clearFieldErrors();
        hideMessage();
        const payload = formPayload(form);
        setBusy(form, true);
        try {
            const data = await post("/register/", payload);
            if (data && data.request_id) {
                goToVerify(data.request_id);
            } else {
                showMessage("Server javobida request_id topilmadi.", "error");
            }
        } catch (error) {
            renderErrors(error, form);
        } finally {
            setBusy(form, false);
        }
    }

    async function handleLogin(event) {
        event.preventDefault();
        const form = event.currentTarget;
        clearFieldErrors();
        hideMessage();
        const payload = formPayload(form);
        setBusy(form, true);
        try {
            await post("/login/", payload);
            form.reset();
            showDone("Kirish muvaffaqiyatli", "Siz hisobingizga kirdingiz.");
        } catch (error) {
            // Agar raqam hali tasdiqlanmagan bo'lsa, backend request_id qaytarishi mumkin.
            if (error instanceof ApiError && error.data && error.data.request_id) {
                goToVerify(error.data.request_id);
                showMessage("Raqamingiz hali tasdiqlanmagan. Telegramga kelgan kodni kiriting.", "error");
            } else {
                renderErrors(error, form);
            }
        } finally {
            setBusy(form, false);
        }
    }

    async function handleVerify(event) {
        event.preventDefault();
        const form = event.currentTarget;
        clearFieldErrors();
        hideMessage();

        const code = els.code.value.trim();
        if (!/^\d{6}$/.test(code)) {
            form.querySelector('[data-error-for="code"]').textContent = "Kod 6 ta raqamdan iborat bo'lishi kerak.";
            els.code.setAttribute("aria-invalid", "true");
            els.code.focus();
            return;
        }

        setBusy(form, true);
        try {
            await post("/verify/", { request_id: requestId, code });
            leaveVerify();
            showDone("Raqam tasdiqlandi", "Endi hisobingizga kirishingiz mumkin.");
        } catch (error) {
            renderErrors(error, form);
        } finally {
            setBusy(form, false);
            els.code.focus();
        }
    }

    async function handleResend() {
        hideMessage();
        els.resendBtn.disabled = true;
        try {
            await post("/verify/resend/", { request_id: requestId });
            showMessage("Yangi kod Telegramga yuborildi.", "success");
            startResendCooldown();
        } catch (error) {
            renderErrors(error, els.formVerify);
            els.resendBtn.disabled = false;
        }
    }

    /* ---------- Init ---------- */

    els.tabLogin.addEventListener("click", () => selectTab("login"));
    els.tabRegister.addEventListener("click", () => selectTab("register"));
    els.formLogin.addEventListener("submit", handleLogin);
    els.formRegister.addEventListener("submit", handleRegister);
    els.formVerify.addEventListener("submit", handleVerify);
    els.resendBtn.addEventListener("click", handleResend);
    els.backBtn.addEventListener("click", leaveVerify);
    els.doneBtn.addEventListener("click", () => {
        selectTab("login");
        showView(els.viewAuth);
    });
    els.code.addEventListener("input", () => {
        els.code.value = els.code.value.replace(/\D/g, "").slice(0, 6);
    });

    if (requestId) {
        showView(els.viewVerify);
        startResendCooldown();
    }
})();
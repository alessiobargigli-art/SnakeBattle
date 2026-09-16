(() => {
  const appName = document.querySelector('meta[name="application-name"]')?.content || document.title || 'App';
  const storageKey = `pwa-install-dismissed:${location.origin}:${appName}`;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => {});
  }

  if (!mobile || standalone) return;

  let dismissedUntil = 0;
  try { dismissedUntil = Number(localStorage.getItem(storageKey) || 0); } catch {}
  if (Date.now() < dismissedUntil) return;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  let deferredPrompt = null;

  const banner = document.createElement('aside');
  banner.className = 'pwa-install-banner';
  banner.hidden = true;
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', `Installa ${appName}`);
  banner.innerHTML = `
    <img class="pwa-install-icon" src="/icons/icon-192.png" alt="" />
    <div class="pwa-install-copy">
      <strong>Installa ${appName}</strong>
      <span id="pwaInstallText">Aprilo come una vera app, a schermo intero.</span>
    </div>
    <div class="pwa-install-actions">
      <button type="button" id="pwaInstallButton">INSTALLA</button>
      <button type="button" id="pwaInstallClose" class="pwa-install-close" aria-label="Chiudi suggerimento">×</button>
    </div>`;
  document.body.appendChild(banner);

  const text = banner.querySelector('#pwaInstallText');
  const installButton = banner.querySelector('#pwaInstallButton');
  const closeButton = banner.querySelector('#pwaInstallClose');
  const menu = document.getElementById('menu');

  function canShow() { return !menu || !menu.classList.contains('hidden'); }

  function show(kind) {
    if (!canShow()) return;
    if (kind === 'ios') {
      text.textContent = 'Su iPhone/iPad: Condividi → Aggiungi alla schermata Home.';
      installButton.textContent = 'HO CAPITO';
    } else if (kind === 'fallback') {
      text.textContent = 'Dal menu del browser scegli “Installa app” o “Aggiungi a schermata Home”.';
      installButton.textContent = 'HO CAPITO';
    } else {
      text.textContent = 'Aprilo come una vera app, a schermo intero.';
      installButton.textContent = 'INSTALLA';
    }
    banner.hidden = false;
  }

  function hide(days = 0) {
    banner.hidden = true;
    if (days > 0) {
      try { localStorage.setItem(storageKey, String(Date.now() + days * 86400000)); } catch {}
    }
  }

  closeButton.addEventListener('click', () => hide(7));
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) { hide(1); return; }
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      hide(choice?.outcome === 'accepted' ? 30 : 1);
    } catch { hide(1); }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    show('native');
  });

  window.addEventListener('appinstalled', () => {
    try { localStorage.removeItem(storageKey); } catch {}
    banner.remove();
  });

  if (menu) {
    new MutationObserver(() => {
      if (menu.classList.contains('hidden')) banner.hidden = true;
    }).observe(menu, { attributes: true, attributeFilter: ['class'] });
  }

  setTimeout(() => {
    if (deferredPrompt) return;
    show(isIOS ? 'ios' : 'fallback');
  }, 1800);
})();

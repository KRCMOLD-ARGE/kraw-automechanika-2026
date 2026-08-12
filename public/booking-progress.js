(() => {
  const form = document.querySelector('#bookingForm');
  if (!form || typeof form.onsubmit !== 'function') return;

  const originalSubmit = form.onsubmit;
  const status = document.createElement('div');
  status.className = 'booking-progress hidden';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.innerHTML = `
    <span class="booking-spinner" aria-hidden="true"></span>
    <div>
      <strong>Please wait. Your appointment is being processed.</strong>
      <span>Please do not close this page. Your reservation will be confirmed shortly.</span>
    </div>`;

  form.appendChild(status);

  const style = document.createElement('style');
  style.textContent = `
    .booking-progress{grid-column:1/-1;display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border:1px solid #bde4f7;background:#eef9ff;border-radius:13px;color:#0d638c;line-height:1.45}
    .booking-progress.hidden{display:none!important}
    .booking-progress strong,.booking-progress span{display:block}
    .booking-progress strong{font-size:14px}
    .booking-progress div>span{font-size:12px;color:#648198;margin-top:3px}
    .booking-spinner{width:20px;height:20px;min-width:20px;border:3px solid rgba(21,159,227,.22);border-top-color:#159fe3;border-radius:50%;animation:kraw-spin .8s linear infinite;margin-top:1px}
    @keyframes kraw-spin{to{transform:rotate(360deg)}}
    .primary-btn:disabled{cursor:wait;opacity:.82}
    @media(max-width:540px){.booking-progress{padding:13px 14px}.booking-progress strong{font-size:13px}}
  `;
  document.head.appendChild(style);

  form.onsubmit = async function(e) {
    status.classList.remove('hidden');
    const submitButton = e.submitter || form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.innerHTML = '<span>Please wait</span><span class="booking-spinner" aria-hidden="true"></span>';
    }
    try {
      await originalSubmit.call(form, e);
    } finally {
      if (!document.querySelector('#formCard')?.classList.contains('hidden')) {
        status.classList.add('hidden');
      }
    }
  };
})();

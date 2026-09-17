document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-link]').forEach(el=>el.addEventListener('click',()=>{window.location.href=el.dataset.link}));

  document.querySelectorAll('[data-toggle]').forEach(toggle=>toggle.addEventListener('click',()=>{
    toggle.classList.toggle('on');
    toggle.setAttribute('aria-pressed',String(toggle.classList.contains('on')));
  }));

  document.querySelectorAll('[data-chip]').forEach(chip=>chip.addEventListener('click',()=>{
    const row=chip.closest('.chip-row');
    row?.querySelectorAll('[data-chip]').forEach(item=>item.classList.remove('active'));
    chip.classList.add('active');
  }));

  document.querySelectorAll('[data-add]').forEach(button=>button.addEventListener('click',()=>{
    const active=button.dataset.added==='true';
    button.dataset.added=String(!active);
    button.classList.toggle('btn-primary',!active);
    button.innerHTML=!active?'<i class="ph ph-check"></i> Added':'Add';
    showToast(!active?'Vehicle added to your garage':'Vehicle removed');
  }));

  document.querySelectorAll('[data-pass-add]').forEach(button=>button.addEventListener('click',()=>{
    button.innerHTML='<i class="ph ph-check"></i>';
    button.style.color='var(--success)';
    showToast('Pass added successfully');
  }));

  const login=document.querySelector('[data-login-form]');
  login?.addEventListener('submit',event=>{
    event.preventDefault();
    const submit=login.querySelector('button[type="submit"]');
    submit.innerHTML='<i class="ph ph-circle-notch ph-spin"></i> Signing in';
    submit.disabled=true;
    setTimeout(()=>{window.location.href='home.html'},650);
  });

  document.querySelectorAll('[data-toast]').forEach(button=>button.addEventListener('click',()=>showToast(button.dataset.toast||'Action completed')));
});

function showToast(message){
  let toast=document.querySelector('.toast');
  if(!toast){toast=document.createElement('div');toast.className='toast';toast.innerHTML='<i class="ph ph-check-circle"></i><span></span>';document.body.appendChild(toast)}
  toast.querySelector('span').textContent=message;
  toast.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer=setTimeout(()=>toast.classList.remove('show'),2200);
}

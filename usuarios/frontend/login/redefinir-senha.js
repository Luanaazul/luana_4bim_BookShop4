document.getElementById('reset-form').addEventListener('submit', async (e) => {
 e.preventDefault(); const status=document.getElementById('status'); const token=new URLSearchParams(location.search).get('token')||'';
 try { const r=await fetch('/redefinir-senha',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,senha:document.getElementById('senha').value})}); const d=await r.json(); if(!r.ok) throw new Error(d.erro||'Falha ao redefinir senha.'); status.textContent=d.mensagem; }
 catch(err){status.textContent=err.message;}
});
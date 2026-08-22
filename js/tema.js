// Conmutador de tema claro/oscuro (sol/luna). La preferencia se guarda en el
// navegador. El arranque sin parpadeo lo hace un mini script en el <head> de
// cada página; aquí solo vive el botón.
(() => {
  const SOL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/></svg>';
  const LUNA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.8A8.3 8.3 0 0 1 9.2 3.5a8.4 8.4 0 1 0 11.3 11.3z"/></svg>';

  const boton = document.getElementById("tema");
  if (!boton) return;

  const pintar = () => {
    const oscuro = document.documentElement.dataset.tema === "oscuro";
    boton.innerHTML = oscuro ? SOL : LUNA;
    boton.setAttribute("aria-label", oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
  };

  boton.addEventListener("click", () => {
    const oscuro = document.documentElement.dataset.tema === "oscuro";
    if (oscuro) delete document.documentElement.dataset.tema;
    else document.documentElement.dataset.tema = "oscuro";
    localStorage.setItem("tema", oscuro ? "claro" : "oscuro");
    pintar();
  });

  pintar();
})();

/* Interface: diagnóstico + lista de espera. Todo conteúdo externo é inserido com textContent (nunca innerHTML). */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const ROTULO = { ok: "OK", atencao: "Atenção", critico: "Crítico", desconhecido: "Não verificado" };

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (k === "class") n.className = v; else n.setAttribute(k, v); });
    kids.flat().forEach((k) => n.append(k instanceof Node ? k : document.createTextNode(String(k ?? ""))));
    return n;
  }

  function origem() {
    const p = new URLSearchParams(location.search);
    const parts = ["utm_source", "utm_medium", "utm_campaign", "ref"].map((k) => p.get(k)).filter(Boolean);
    return (parts.join(" / ") || (document.referrer ? "referência: " + new URL(document.referrer).hostname : "direto")).slice(0, 120);
  }

  function render(r) {
    const box = $("diag-resultado");
    box.replaceChildren();
    const a = r.assessment;
    const fatos = [r.provider, r.rdap.ok && r.rdap.registrar ? "Registrador: " + r.rdap.registrar : null,
      r.rdap.ok && r.rdap.registered ? "Registrado em " + r.rdap.registered.slice(0, 10) : null,
      r.ns.length ? "DNS: " + r.ns.slice(0, 2).map((n) => n.replace(/\.$/, "")).join(", ") : null].filter(Boolean);
    box.append(
      el("div", { class: "resumo" },
        el("div", {}, el("div", { class: "nota-grande" }, a.score === null ? "—" : a.score + "/100"),
          el("div", { class: "nota" }, a.unverified ? `dos ${a.verified} itens verificados (${a.unverified} indisponível agora)` : "itens em ordem")),
        el("div", {}, el("strong", {}, r.domain), el("div", {}, el("span", { class: "badge b-" + a.overall }, "Situação geral: " + ROTULO[a.overall]))),
        el("div", { class: "chips" }, fatos.map((f) => el("span", { class: "chip" }, f)))),
      el("div", { class: "checks" }, a.checks.map((c) =>
        el("div", { class: "check st-" + c.status },
          el("h4", {}, c.titulo, el("span", { class: "badge b-" + c.status }, ROTULO[c.status])),
          el("p", {}, c.detalhe), c.recomendacao ? el("p", { class: "rec" }, "→ " + c.recomendacao) : ""))),
      el("div", { class: "cta-diag" },
        el("span", {}, "Quer que avisemos antes de qualquer item deste domínio — e dos outros domínios dos seus clientes — vencer?"),
        el("a", { class: "btn", href: "#lista" }, "Entrar na lista de espera")));
    box.hidden = false;
    $("diag_dominio").value = r.domain;
  }

  function initDiag() {
    const form = $("form-diag");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const st = $("diag-status"), btn = $("btn-diag");
      st.className = "status";
      btn.disabled = true;
      try {
        const r = await window.Diagnostico.run($("dominio").value, (m) => { st.textContent = m; });
        render(r);
        st.textContent = "Diagnóstico concluído.";
      } catch (e) {
        st.className = "status erro";
        st.textContent = e && e.message ? e.message : "Não foi possível concluir o diagnóstico. Tente novamente.";
      } finally { btn.disabled = false; }
    });
  }

  /* POST no-cors (corpo urlencoded = sem preflight). A promessa só resolve quando a resposta do Google chega e rejeita em
     falha de rede/tempo esgotado. A resposta é opaca: a compatibilidade das opções é garantida por configurar_form.py. */
  async function enviarGoogleForms(cfg, dados) {
    const corpo = new URLSearchParams();
    Object.entries(dados).forEach(([k, v]) => { if (cfg.fields[k]) corpo.append(cfg.fields[k], v); });
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      await fetch(cfg.formEndpoint, { method: "POST", mode: "no-cors", body: corpo, keepalive: true, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  function initLista() {
    $("origem").value = origem();
    const form = $("form-lista");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const st = $("lista-status");
      st.className = "status";
      if (!form.checkValidity()) {
        st.className = "status erro";
        st.textContent = "Preencha os campos obrigatórios e aceite a política de privacidade.";
        form.reportValidity();
        return;
      }
      const dados = Object.fromEntries(new FormData(form).entries());
      dados.consent = $("consent").checked ? "sim — " + new Date().toISOString() : "";
      const cfg = window.PZ_CONFIG || {};
      $("btn-lista").disabled = true;
      try {
        if (cfg.formEndpoint) {
          await enviarGoogleForms(cfg, dados);
          st.className = "status sucesso";
          st.textContent = "Pronto! Você está na lista. Entraremos em contato antes do lançamento.";
          form.reset(); $("origem").value = origem();
        } else {
          try { localStorage.setItem("pz_demo_lead", JSON.stringify({ ...dados, em: new Date().toISOString() })); } catch (e) { /* sem storage */ }
          st.className = "status sucesso";
          st.textContent = "Modo demonstração: o cadastro ainda não está ativo (pré-lançamento). Nenhum dado foi enviado.";
        }
      } catch (e) {
        st.className = "status erro";
        st.textContent = "Não foi possível enviar agora. Tente novamente em instantes.";
      } finally { $("btn-lista").disabled = false; }
    });
  }

  document.addEventListener("DOMContentLoaded", () => { initDiag(); initLista(); });
})();

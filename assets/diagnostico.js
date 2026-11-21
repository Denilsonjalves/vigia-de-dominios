/* Diagnóstico gratuito de domínio — roda 100% no navegador do visitante (sem servidor, sem custo, sem armazenar
 * o domínio). Fontes públicas oficiais/abertas, todas com CORS liberado (verificado em 2026-11-20):
 *   DNS via DNS-over-HTTPS (Google Public DNS, Cloudflare como reserva) · RDAP (bootstrap IANA) · crt.sh (CT logs).
 * Segurança: todo dado externo (ex.: registros TXT) é tratado como texto — nunca HTML.
 * Funções puras exportadas para testes em Node (tests/diagnostico.test.mjs). */
(function (root) {
  "use strict";

  const BR_2LD = new Set(["com", "net", "org", "gov", "edu", "art", "ind", "inf", "eco", "emp", "eng", "srv", "tec", "app",
    "dev", "blog", "log", "med", "adv", "arq", "mus", "rec", "tur", "jus", "leg", "mil", "nom", "ong", "psi", "seg", "tv"]);

  function normalizeDomain(input) {
    let d = String(input || "").trim().toLowerCase();
    d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[\/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
    if (d.startsWith("www.")) d = d.slice(4);
    if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) return null;
    return d;
  }

  /** Domínio registrável aproximado (sem lista pública de sufixos): trata .br de 2º nível (com.br, net.br...). */
  function registrable(domain) {
    const p = domain.split(".");
    if (p.length >= 3 && p[p.length - 1] === "br" && BR_2LD.has(p[p.length - 2])) return p.slice(-3).join(".");
    if (p.length >= 3 && ["uk", "au", "jp", "nz", "za", "ar", "mx", "co"].includes(p[p.length - 1]) && p[p.length - 2].length <= 3)
      return p.slice(-3).join(".");
    return p.slice(-2).join(".");
  }

  const MX_VENDORS = [[/aspmx\.l\.google\.com|googlemail\.com|smtp\.google\.com/i, "Google Workspace"],
    [/mail\.protection\.outlook\.com/i, "Microsoft 365"], [/zoho\.(com|eu|in)/i, "Zoho Mail"], [/pphosted\.com/i, "Proofpoint"],
    [/mimecast/i, "Mimecast"], [/barracudanetworks/i, "Barracuda"], [/secureserver\.net/i, "GoDaddy"], [/titan\.email/i, "Titan"],
    [/hostinger/i, "Hostinger"], [/locaweb/i, "Locaweb"], [/uhserver|uol\.com\.br/i, "UOL Host"], [/kinghost/i, "KingHost"],
    [/hostgator/i, "HostGator"], [/amazonaws|amazonses/i, "Amazon"], [/icloud\.com/i, "Apple iCloud"], [/protonmail|proton\.me/i, "Proton"]];

  function emailProvider(mxHosts) {
    if (!mxHosts.length) return "Sem e-mail configurado (sem MX)";
    const all = mxHosts.join(" ");
    const hit = MX_VENDORS.filter(([rx]) => rx.test(all)).map(([, n]) => n);
    return hit.length ? hit.join(" + ") : "Servidor próprio / outro provedor";
  }

  function parseSPF(txts) {
    const spf = txts.find((t) => /^v=spf1\b/i.test(t.trim()));
    if (!spf) return { present: false };
    const all = (spf.match(/([~?+-])all\b/i) || [])[1];
    const lookups = (spf.match(/\b(include|a|mx|ptr|exists|redirect)[:=]/gi) || []).length;
    return { present: true, record: spf, allQualifier: all || null, strict: all === "-" || all === "~", lookups };
  }

  function parseDMARC(txts) {
    const d = txts.find((t) => /^v=dmarc1\b/i.test(t.trim()));
    if (!d) return { present: false };
    const tag = (k) => ((d.match(new RegExp("(?:^|;)\\s*" + k + "=([^;]+)", "i")) || [])[1] || "").trim().toLowerCase();
    return { present: true, record: d, policy: tag("p") || null, reports: !!tag("rua"), pct: tag("pct") || "100" };
  }

  function daysUntil(iso, now) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.floor((t - (now || Date.now())) / 86400000);
  }

  /** Avaliação em linguagem simples. status: ok | atencao | critico | desconhecido */
  function assess(r, now) {
    const checks = [];
    const add = (id, titulo, status, detalhe, recomendacao) => checks.push({ id, titulo, status, detalhe, recomendacao });
    // Domínio
    if (r.rdap && r.rdap.ok && r.rdap.expires) {
      const d = daysUntil(r.rdap.expires, now);
      if (d < 0) add("dominio", "Vencimento do domínio", "critico", `Vencido há ${-d} dia(s) (${r.rdap.expires.slice(0, 10)}).`, "Renove imediatamente no registrador.");
      else if (d <= 30) add("dominio", "Vencimento do domínio", "critico", `Vence em ${d} dia(s) (${r.rdap.expires.slice(0, 10)}).`, "Renove agora e ative a renovação automática.");
      else if (d <= 60) add("dominio", "Vencimento do domínio", "atencao", `Vence em ${d} dias (${r.rdap.expires.slice(0, 10)}).`, "Programe a renovação.");
      else add("dominio", "Vencimento do domínio", "ok", `Vence em ${d} dias (${r.rdap.expires.slice(0, 10)}).`, "");
    } else add("dominio", "Vencimento do domínio", "desconhecido", "O registro oficial (RDAP) não informou a data agora.", "Confira no painel do registrador.");
    // SSL
    if (r.ssl && r.ssl.ok) {
      const d = daysUntil(r.ssl.notAfter, now);
      if (d < 0) add("ssl", "Certificado SSL", "critico", "O certificado mais recente está vencido.", "Renove o certificado — navegadores exibem alerta de site não seguro.");
      // Limites calibrados no teste real: certificados de 90 dias renovam sozinhos ~30 dias antes; alertar em 30 dias
      // geraria alarme falso em sites saudáveis. Se faltam 14 dias e não renovou, a automação provavelmente falhou.
      else if (d <= 7) add("ssl", "Certificado SSL", "critico", `Vence em ${d} dia(s) (${r.ssl.issuer || "emissor desconhecido"}).`, "Renove já: a renovação automática parece ter falhado.");
      else if (d <= 14) add("ssl", "Certificado SSL", "atencao", `Vence em ${d} dias (${r.ssl.issuer || "emissor desconhecido"}).`, "Confirme que a renovação automática está funcionando.");
      else add("ssl", "Certificado SSL", "ok", `Válido por mais ${d} dias (${r.ssl.issuer || "emissor desconhecido"}).`, "");
    } else add("ssl", "Certificado SSL", "desconhecido", "Não foi possível consultar os registros públicos de certificados agora.", "Tente novamente em instantes.");
    // E-mail
    if (!r.mx.length) add("email", "Recebimento de e-mail", "atencao", "O domínio não tem servidor de e-mail (MX).", "Se o domínio usa e-mail, configure os registros MX.");
    else add("email", "Recebimento de e-mail", "ok", `Provedor: ${emailProvider(r.mx)}.`, "");
    if (!r.spf.present) add("spf", "Proteção contra falsificação (SPF)", r.mx.length ? "critico" : "atencao", "Nenhum registro SPF encontrado.", "Publique um SPF listando quem pode enviar e-mails pelo domínio.");
    else if (!r.spf.strict) add("spf", "Proteção contra falsificação (SPF)", "atencao", `SPF presente, mas permissivo (${r.spf.allQualifier ? r.spf.allQualifier + "all" : "sem 'all'"}).`, "Termine o SPF com ~all ou -all.");
    else if (r.spf.lookups > 10) add("spf", "Proteção contra falsificação (SPF)", "atencao", `SPF com ${r.spf.lookups} consultas (limite técnico: 10).`, "Reduza os includes para não falhar a validação.");
    else add("spf", "Proteção contra falsificação (SPF)", "ok", "SPF configurado.", "");
    if (!r.dmarc.present) add("dmarc", "Política anti-phishing (DMARC)", "critico", "Nenhuma política DMARC publicada.", "Publique um DMARC (comece com p=none e relatórios) e evolua para quarantine/reject.");
    else if (r.dmarc.policy === "none") add("dmarc", "Política anti-phishing (DMARC)", "atencao", "DMARC em modo apenas monitoramento (p=none).", "Evolua para p=quarantine ou p=reject após analisar os relatórios.");
    else add("dmarc", "Política anti-phishing (DMARC)", "ok", `DMARC com p=${r.dmarc.policy}.`, "");
    // Nota e situação geral só com itens VERIFICADOS: falha de uma fonte pública não pode piorar o domínio do visitante.
    const order = { critico: 3, atencao: 2, ok: 0 };
    const verified = checks.filter((c) => c.status !== "desconhecido");
    const worst = verified.length ? verified.reduce((w, c) => (order[c.status] > order[w] ? c.status : w), "ok") : "desconhecido";
    const score = verified.length ? Math.round(100 * verified.filter((c) => c.status === "ok").length / verified.length) : null;
    return { checks, overall: worst, score, verified: verified.length, unverified: checks.length - verified.length };
  }

  // ------------------------------------------------------------------ rede (navegador)
  async function getJSON(url, ms, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 10000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer" }, opts || {}));
      if (!r.ok) return { _status: r.status };
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function doh(name, type) {
    const enc = encodeURIComponent(name);
    for (const url of [`https://dns.google/resolve?name=${enc}&type=${type}`, `https://cloudflare-dns.com/dns-query?name=${enc}&type=${type}`]) {
      try {
        const j = await getJSON(url, 6000, url.includes("cloudflare") ? { headers: { accept: "application/dns-json" } } : undefined);
        if (j && typeof j.Status === "number") return (j.Answer || []).filter((a) => a.type === { MX: 15, TXT: 16, NS: 2, CAA: 257 }[type] || type === "A")
          .map((a) => String(a.data).replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
      } catch (e) { /* tenta a reserva */ }
    }
    return [];
  }

  let bootstrap = null;
  async function rdap(domain) {
    try {
      if (!bootstrap) {
        const b = await getJSON("https://data.iana.org/rdap/dns.json", 8000);
        bootstrap = {};
        (b.services || []).forEach(([tlds, urls]) => tlds.forEach((t) => { bootstrap[t.toLowerCase()] = urls[0].replace(/\/?$/, "/"); }));
      }
      const base = bootstrap[domain.split(".").pop()];
      if (!base) return { ok: false };
      const j = await getJSON(base + "domain/" + domain, 10000, { headers: { accept: "application/rdap+json" } });
      if (!j || j._status) return { ok: false, status: j && j._status };
      const ev = {};
      (j.events || []).forEach((e) => { ev[e.eventAction] = e.eventDate; });
      let registrar = null;   // só o registrador (empresa); dados do titular nunca são exibidos (LGPD)
      (j.entities || []).forEach((en) => {
        if ((en.roles || []).includes("registrar")) ((en.vcardArray || [null, []])[1] || []).forEach((it) => { if (it[0] === "fn") registrar = it[3]; });
      });
      return { ok: true, registered: ev.registration || null, expires: ev.expiration || null, registrar };
    } catch (e) { return { ok: false }; }
  }

  /** Certificado mais recente pelos logs públicos de Certificate Transparency: crt.sh e, como reserva, Cert Spotter
   * (ambos com CORS; o crt.sh falhou de forma intermitente no teste real de 2026-11-20). */
  function latestCert(entries, names, namesOf, notAfterOf, issuerOf) {
    const mine = entries.filter((c) => namesOf(c).some((n) => names.has(String(n).trim().toLowerCase())));
    if (!mine.length) return null;
    const latest = mine.reduce((a, b) => (Date.parse(notAfterOf(b)) > Date.parse(notAfterOf(a)) ? b : a));
    return { ok: true, notAfter: notAfterOf(latest), issuer: issuerOf(latest) };
  }

  async function sslFromCT(domain) {
    const names = new Set([domain, "www." + domain, "*." + domain]);
    const org = (s) => (String(s || "").match(/O=([^,]+)/) || [])[1] || null;
    try {
      const j = await getJSON(`https://crt.sh/?q=${encodeURIComponent(domain)}&output=json&exclude=expired&deduplicate=Y`, 12000);
      if (Array.isArray(j)) {
        const r = latestCert(j, names, (c) => String(c.name_value || "").split(/\n/), (c) => c.not_after + "Z", (c) => org(c.issuer_name));
        if (r) return Object.assign(r, { source: "crt.sh" });
      }
    } catch (e) { /* reserva abaixo */ }
    try {
      const j = await getJSON(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}&expand=dns_names&expand=issuer`, 12000);
      if (Array.isArray(j)) {
        const r = latestCert(j, names, (c) => c.dns_names || [], (c) => c.not_after,
          (c) => org((c.issuer || {}).name) || (c.issuer || {}).friendly_name || null);
        if (r) return Object.assign(r, { source: "Cert Spotter" });
      }
    } catch (e) { /* sem dados */ }
    return { ok: false };
  }

  async function run(input, onProgress) {
    const domain = normalizeDomain(input);
    if (!domain) throw new Error("Domínio inválido. Exemplo: suaagencia.com.br");
    const reg = registrable(domain);
    const step = (m) => onProgress && onProgress(m);
    step("Consultando DNS…");
    const [mx, txt, dmarcTxt, ns] = await Promise.all([doh(reg, "MX"), doh(reg, "TXT"), doh("_dmarc." + reg, "TXT"), doh(reg, "NS")]);
    step("Consultando o registro oficial do domínio (RDAP) e os logs públicos de certificados…");
    const [rd, ssl] = await Promise.all([rdap(reg), sslFromCT(domain)]);
    const r = { domain, registrable: reg, mx: mx.map((m) => m.split(/\s+/).pop()), txt, spf: parseSPF(txt), dmarc: parseDMARC(dmarcTxt), ns, rdap: rd, ssl };
    r.provider = emailProvider(r.mx);
    r.assessment = assess(r);
    return r;
  }

  const api = { normalizeDomain, registrable, emailProvider, parseSPF, parseDMARC, daysUntil, assess, latestCert, run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Diagnostico = api;
})(typeof window !== "undefined" ? window : globalThis);

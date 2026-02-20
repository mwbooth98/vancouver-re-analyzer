import { useState, useMemo, useEffect, useCallback, useRef } from "react";

// ─── Storage abstraction ─────────────────────────────────────────────────────
// Uses window.storage (Claude artifact) when available, falls back to
// localStorage (GitHub Pages / any regular browser environment).

const storage = {
  async get(key) {
    try {
      if (window.storage) {
        const r = await window.storage.get(key);
        return r ? r.value : null;
      }
    } catch (_) {}
    try { return localStorage.getItem(key); } catch (_) { return null; }
  },
  async set(key, value) {
    try {
      if (window.storage) { await window.storage.set(key, value); return; }
    } catch (_) {}
    try { localStorage.setItem(key, value); } catch (_) {}
  },
  async delete(key) {
    try {
      if (window.storage) { await window.storage.delete(key); return; }
    } catch (_) {}
    try { localStorage.removeItem(key); } catch (_) {}
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function calcPTT(price) {
  if (price <= 200000) return price * 0.01;
  if (price <= 2000000) return 200000 * 0.01 + (price - 200000) * 0.02;
  if (price <= 3000000) return 200000 * 0.01 + 1800000 * 0.02 + (price - 2000000) * 0.03;
  return 200000 * 0.01 + 1800000 * 0.02 + 1000000 * 0.03 + (price - 3000000) * 0.05;
}

function calcMonthlyMortgage(principal, annualRate, years) {
  if (!principal || !annualRate || !years) return { payment: 0, interest: 0, principal: 0 };
  const r = annualRate / 100 / 12;
  const n = years * 12;
  if (r === 0) { const p = principal / n; return { payment: p, interest: 0, principal: p }; }
  const payment = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  const interest = principal * r;
  return { payment, interest, principal: payment - interest };
}

function fmt(n, dec = 0) {
  return n.toLocaleString("en-CA", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtDollar(n, dec = 0) { return "$" + fmt(n, dec); }

const VANCOUVER_BENCHMARKS = {
  condoPricePerSqft: 1050,
  townhomePricePerSqft: 780,
  strataPerSqft: 0.65,
  avgCapRate: 3.0,
};

// Sample property shown to public visitors so the tool isn't empty
const SAMPLE_PROPERTY = {
  id: "sample",
  name: "📍 Sample — Yaletown 1BR",
  listingUrl: "",
  purchasePrice: "749000",
  downPaymentPct: "20",
  mortgageRate: "5.25",
  amortization: "25",
  strataFees: "480",
  annualPropertyTax: "3200",
  annualHomeInsurance: "1500",
  maintenanceReserve: "200",
  legalFees: "2000",
  homeInspection: "600",
  titleInsurance: "300",
  squareFootage: "620",
  propertyType: "condo",
  estimatedRent: "2800",
  yearBuilt: "2009",
};

const EMPTY_PROPERTY = {
  name: "New Property",
  listingUrl: "",
  purchasePrice: "",
  downPaymentPct: "20",
  mortgageRate: "5.25",
  amortization: "25",
  strataFees: "",
  annualPropertyTax: "",
  annualHomeInsurance: "1500",
  maintenanceReserve: "200",
  legalFees: "2000",
  homeInspection: "600",
  titleInsurance: "300",
  squareFootage: "",
  propertyType: "condo",
  estimatedRent: "",
  yearBuilt: "",
};

function newId() { return "prop_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7); }

// Storage keys
const STORAGE_KEY_PROPS  = "re_properties_v1";
const STORAGE_KEY_ACTIVE = "re_active_idx_v1";
const STORAGE_KEY_MODE   = "re_mode_v1"; // "owner" | "public"

// ─── Sub-components ─────────────────────────────────────────────────────────

function InputField({ label, value, onChange, prefix, suffix, type = "number", placeholder, hint }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">
        {label}
        {hint && <span className="ml-1 normal-case tracking-normal font-normal text-stone-500">({hint})</span>}
      </label>
      <div className="relative flex items-center">
        {prefix && <span className="absolute left-3 text-stone-400 text-sm pointer-events-none">{prefix}</span>}
        <input
          type={type === "url" ? "url" : "text"}
          inputMode={type === "number" ? "decimal" : undefined}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-stone-800 border border-stone-700 rounded-lg py-2.5 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors ${prefix ? "pl-7" : "pl-3"} ${suffix ? "pr-10" : "pr-3"}`}
        />
        {suffix && <span className="absolute right-3 text-stone-400 text-sm pointer-events-none">{suffix}</span>}
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-stone-800 border border-stone-700 rounded-lg py-2.5 px-3 text-sm text-stone-100 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function StatCard({ label, value, sub, accent = false, warn = false, good = false }) {
  const bg = accent ? "bg-amber-500/10 border-amber-500/30" : warn ? "bg-amber-400/10 border-amber-400/20" : good ? "bg-emerald-500/10 border-emerald-500/25" : "bg-stone-800/60 border-stone-700/50";
  const tc = accent ? "text-amber-400" : warn ? "text-amber-300" : good ? "text-emerald-400" : "text-stone-100";
  return (
    <div className={`rounded-xl p-4 border ${bg}`}>
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">{label}</p>
      <p className={`font-bold text-xl ${tc}`}>{value}</p>
      {sub && <p className="text-xs text-stone-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children, icon }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <span className="text-amber-500 text-lg">{icon}</span>
      <h2 className="text-sm font-bold uppercase tracking-widest text-stone-300">{children}</h2>
      <div className="flex-1 h-px bg-stone-700/60" />
    </div>
  );
}

function BarChart({ total, nonRecoverable }) {
  const pct = total > 0 ? Math.round((nonRecoverable / total) * 100) : 0;
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-stone-500 mb-1">
        <span>Total monthly cost</span><span>{fmtDollar(total)}</span>
      </div>
      <div className="relative h-7 rounded-lg overflow-hidden bg-stone-700/40">
        <div className="absolute left-0 top-0 h-full bg-red-500/70 rounded-lg transition-all duration-500" style={{ width: `${pct}%` }} />
        <div className="absolute inset-0 flex items-center px-3">
          <span className="text-xs font-semibold text-white/90 drop-shadow">{pct}% non-recoverable</span>
        </div>
      </div>
      <div className="flex gap-4 mt-2">
        <div className="flex items-center gap-1.5 text-xs text-stone-400"><div className="w-3 h-3 rounded-sm bg-amber-500/70" />Recoverable (principal)</div>
        <div className="flex items-center gap-1.5 text-xs text-stone-400"><div className="w-3 h-3 rounded-sm bg-red-500/70" />Non-recoverable</div>
      </div>
    </div>
  );
}

function MetricRow({ label, value, context, status }) {
  const dot = status === "good" ? "bg-emerald-400" : status === "warn" ? "bg-amber-400" : status === "bad" ? "bg-red-400" : "bg-transparent";
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-700/40 last:border-0">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />
        <span className="text-sm text-stone-300">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-sm font-semibold text-stone-100">{value}</span>
        {context && <span className="text-xs text-stone-500 ml-2">{context}</span>}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function RealEstateDashboard() {
  const [mode, setMode]             = useState(null); // null = loading | "owner" | "public"
  const [properties, setProperties] = useState(null); // null = loading
  const [activeIdx, setActiveIdx]   = useState(0);
  const [formCollapsed, setFormCollapsed] = useState(false);
  const [sliderDownPct, setSliderDownPct] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "saved"
  const saveTimer = useRef(null);

  // ── Load from storage on mount ───────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [savedMode, savedProps, savedIdx] = await Promise.all([
          storage.get(STORAGE_KEY_MODE),
          storage.get(STORAGE_KEY_PROPS),
          storage.get(STORAGE_KEY_ACTIVE),
        ]);

        const resolvedMode = savedMode || "public";
        setMode(resolvedMode);

        if (resolvedMode === "owner" && savedProps) {
          const parsed = JSON.parse(savedProps);
          setProperties(parsed.length > 0 ? parsed : [{ ...EMPTY_PROPERTY, id: newId(), name: "My First Property" }]);
          setActiveIdx(savedIdx ? parseInt(savedIdx) : 0);
        } else {
          // Public mode: always start fresh with sample property
          setProperties([{ ...SAMPLE_PROPERTY }]);
          setActiveIdx(0);
        }
      } catch (_) {
        setMode("public");
        setProperties([{ ...SAMPLE_PROPERTY }]);
      }
    })();
  }, []);

  // ── Auto-save owner properties ────────────────────────────────────────────
  useEffect(() => {
    if (mode !== "owner" || properties === null) return;
    clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      await storage.set(STORAGE_KEY_PROPS, JSON.stringify(properties));
      await storage.set(STORAGE_KEY_ACTIVE, String(activeIdx));
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    }, 800);
    return () => clearTimeout(saveTimer.current);
  }, [properties, activeIdx, mode]);

  // ── Switch mode ───────────────────────────────────────────────────────────
  async function switchToOwner() {
    await storage.set(STORAGE_KEY_MODE, "owner");
    setMode("owner");
    // Load owner's saved properties, or start fresh
    try {
      const saved = await storage.get(STORAGE_KEY_PROPS);
      if (saved) {
        const parsed = JSON.parse(saved);
        setProperties(parsed.length > 0 ? parsed : [{ ...EMPTY_PROPERTY, id: newId(), name: "My First Property" }]);
      } else {
        setProperties([{ ...EMPTY_PROPERTY, id: newId(), name: "My First Property" }]);
      }
    } catch (_) {
      setProperties([{ ...EMPTY_PROPERTY, id: newId(), name: "My First Property" }]);
    }
    setActiveIdx(0);
    setSliderDownPct(null);
  }

  async function switchToPublic() {
    await storage.set(STORAGE_KEY_MODE, "public");
    setMode("public");
    setProperties([{ ...SAMPLE_PROPERTY }]);
    setActiveIdx(0);
    setSliderDownPct(null);
  }

  // ── Property CRUD ─────────────────────────────────────────────────────────
  function updateProp(field, value) {
    setProperties(prev => prev.map((p, i) => i === activeIdx ? { ...p, [field]: value } : p));
    if (field === "downPaymentPct") setSliderDownPct(null);
  }

  function addProperty() {
    const np = { ...EMPTY_PROPERTY, id: newId(), name: `Property ${properties.length + 1}` };
    setProperties(prev => [...prev, np]);
    setActiveIdx(properties.length);
    setSliderDownPct(null);
  }

  function removeProperty(idx) {
    if (properties.length === 1) return;
    setProperties(prev => prev.filter((_, i) => i !== idx));
    setActiveIdx(prev => Math.max(0, prev >= idx ? prev - 1 : prev));
    setSliderDownPct(null);
  }

  function switchProperty(idx) {
    setActiveIdx(idx);
    setSliderDownPct(null);
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (mode === null || properties === null) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <div className="text-stone-500 text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  const prop = properties[activeIdx] || properties[0];
  const baseDownPct = parseFloat(prop.downPaymentPct) || 20;
  const effectiveDownPct = sliderDownPct !== null ? sliderDownPct : baseDownPct;

  // ── Calculations ──────────────────────────────────────────────────────────
  const calcs = (() => {
    const price    = parseFloat(prop.purchasePrice) || 0;
    const downPct  = effectiveDownPct;
    const downAmt  = price * (downPct / 100);
    const loanAmt  = price - downAmt;
    const rate     = parseFloat(prop.mortgageRate) || 0;
    const amort    = parseInt(prop.amortization) || 25;
    const sqft     = parseFloat(prop.squareFootage) || 0;

    const ptt      = calcPTT(price);
    const legalFees = parseFloat(prop.legalFees) || 0;
    const inspection = parseFloat(prop.homeInspection) || 0;
    const titleIns  = parseFloat(prop.titleInsurance) || 0;
    const totalUpfront = ptt + legalFees + inspection + titleIns + downAmt;
    const totalUpfrontExcludingDown = ptt + legalFees + inspection + titleIns;

    const { payment: mortgagePayment, interest: mortgageInterest, principal: mortgagePrincipal } =
      calcMonthlyMortgage(loanAmt, rate, amort);

    const strataFees   = parseFloat(prop.strataFees) || 0;
    const propTax      = (parseFloat(prop.annualPropertyTax) || 0) / 12;
    const insurance    = (parseFloat(prop.annualHomeInsurance) || 0) / 12;
    const maintenance  = parseFloat(prop.maintenanceReserve) || 0;

    const totalMonthly        = mortgagePayment + strataFees + propTax + insurance + maintenance;
    const totalNonRecoverable = mortgageInterest + strataFees + propTax + insurance + maintenance;

    const pricePerSqft  = sqft > 0 ? price / sqft : 0;
    const strataPerSqft = sqft > 0 && strataFees > 0 ? strataFees / sqft : 0;
    const estimatedRent = parseFloat(prop.estimatedRent) || 0;
    const grossRentMultiplier = estimatedRent > 0 ? price / (estimatedRent * 12) : 0;
    const annualNOI = estimatedRent > 0
      ? (estimatedRent * 12) - (strataFees * 12) - (parseFloat(prop.annualPropertyTax) || 0) - (parseFloat(prop.annualHomeInsurance) || 0) - (maintenance * 12)
      : 0;
    const capRate      = price > 0 && annualNOI > 0 ? (annualNOI / price) * 100 : 0;
    const rentVsNonRec = estimatedRent > 0 ? totalNonRecoverable - estimatedRent : null;
    const effectiveLTV = price > 0 ? (loanAmt / price) * 100 : 0;
    const yearBuilt    = parseInt(prop.yearBuilt) || 0;
    const buildingAge  = yearBuilt > 0 ? new Date().getFullYear() - yearBuilt : null;
    const benchmarkPPSF = prop.propertyType === "condo" ? VANCOUVER_BENCHMARKS.condoPricePerSqft : VANCOUVER_BENCHMARKS.townhomePricePerSqft;
    const priceVsBenchmark = pricePerSqft > 0 ? ((pricePerSqft - benchmarkPPSF) / benchmarkPPSF) * 100 : null;

    return {
      price, downAmt, downPct, loanAmt, effectiveLTV,
      ptt, legalFees, inspection, titleIns,
      totalUpfrontExcludingDown, totalUpfront,
      mortgagePayment, mortgageInterest, mortgagePrincipal,
      strataFees, propTax, insurance, maintenance,
      totalMonthly, totalNonRecoverable,
      sqft, pricePerSqft, strataPerSqft, benchmarkPPSF, priceVsBenchmark,
      estimatedRent, grossRentMultiplier, capRate, rentVsNonRec,
      buildingAge,
    };
  })();

  const hasMetrics = calcs.sqft > 0 || calcs.estimatedRent > 0;
  const isOwner    = mode === "owner";

  return (
    <div style={{ fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }} className="min-h-screen bg-stone-900 text-stone-100 p-4 md:p-6">

      {/* ── Header ── */}
      <div className="max-w-6xl mx-auto mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-amber-500 font-semibold mb-0.5">Vancouver Real Estate</p>
            <h1 className="text-2xl font-bold text-stone-100">Purchase Analyzer</h1>
          </div>

          {/* Mode toggle + save indicator */}
          <div className="flex items-center gap-3">
            {isOwner && saveStatus !== "idle" && (
              <span className={`text-xs transition-opacity ${saveStatus === "saving" ? "text-stone-500" : "text-emerald-400"}`}>
                {saveStatus === "saving" ? "Saving…" : "✓ Saved"}
              </span>
            )}
            <div className="flex items-center bg-stone-800 border border-stone-700 rounded-xl p-1 gap-1">
              <button
                onClick={switchToOwner}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${isOwner ? "bg-amber-500 text-stone-900 shadow-md" : "text-stone-400 hover:text-stone-200"}`}
              >
                🔒 My Properties
              </button>
              <button
                onClick={switchToPublic}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${!isOwner ? "bg-stone-600 text-stone-100 shadow-md" : "text-stone-400 hover:text-stone-200"}`}
              >
                🌐 Public View
              </button>
            </div>
          </div>
        </div>

        {/* Mode banner */}
        {isOwner ? (
          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-3 py-2">
            <span>🔒</span>
            <span>Owner mode — your properties are automatically saved and will be here when you return.</span>
          </div>
        ) : (
          <div className="mt-3 flex items-center justify-between gap-2 text-xs bg-stone-800/60 border border-stone-700/50 rounded-lg px-3 py-2">
            <span className="text-stone-400">🌐 Public view — loaded with a sample property. Your changes are yours only and won't affect anyone else.</span>
            <button onClick={switchToOwner} className="text-amber-500 hover:text-amber-400 font-semibold whitespace-nowrap transition-colors">Switch to owner →</button>
          </div>
        )}
      </div>

      <div className="max-w-6xl mx-auto">
        {/* ── Property Tabs ── */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {properties.map((p, i) => (
            <button
              key={p.id || i}
              onClick={() => switchProperty(i)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                i === activeIdx
                  ? "bg-amber-500 text-stone-900 border-amber-500 shadow-lg shadow-amber-500/20"
                  : "bg-stone-800 text-stone-400 border-stone-700 hover:border-stone-500 hover:text-stone-200"
              }`}
            >
              {p.name || `Property ${i + 1}`}
              {properties.length > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); removeProperty(i); }}
                  className={`ml-1 text-xs rounded px-0.5 ${i === activeIdx ? "hover:bg-amber-600/50" : "hover:bg-stone-600"}`}
                >×</span>
              )}
            </button>
          ))}
          {(isOwner || properties.length === 1) && (
            <button
              onClick={addProperty}
              className="px-3 py-1.5 rounded-lg text-sm text-stone-500 border border-dashed border-stone-700 hover:border-amber-500 hover:text-amber-500 transition-all"
            >
              + Add Property
            </button>
          )}
        </div>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Left: Collapsible Form */}
          <div className="lg:col-span-1">
            <div className="bg-stone-900/80 border border-stone-700/60 rounded-2xl overflow-hidden">
              <button
                onClick={() => setFormCollapsed(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-stone-800/40 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-amber-500 text-base">✏️</span>
                  <div className="text-left">
                    <p className="text-sm font-bold text-stone-200 group-hover:text-white transition-colors">
                      {prop.name || "Property Details"}
                    </p>
                    {formCollapsed && calcs.price > 0 && (
                      <p className="text-xs text-stone-500 mt-0.5">{fmtDollar(calcs.price)} · {calcs.downPct}% dn · {prop.mortgageRate}% · {prop.amortization}yr</p>
                    )}
                    {formCollapsed && !calcs.price && (
                      <p className="text-xs text-stone-600">Click to enter property details</p>
                    )}
                  </div>
                </div>
                <div className={`text-stone-500 group-hover:text-stone-300 transition-transform duration-200 ${formCollapsed ? "" : "rotate-180"}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </button>

              {!formCollapsed && (
                <div className="px-5 pb-5 border-t border-stone-700/40">
                  <div className="mt-4">
                    <div className="mb-4 pb-4 border-b border-stone-700/50">
                      <label className="block text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">Property Name</label>
                      <input
                        type="text"
                        value={prop.name}
                        onChange={e => updateProp("name", e.target.value)}
                        className="w-full bg-stone-800 border border-stone-700 rounded-lg py-2 px-3 text-sm text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-colors font-medium"
                      />
                    </div>

                    <InputField label="Realtor.ca Listing URL" type="url" value={prop.listingUrl} onChange={v => updateProp("listingUrl", v)} placeholder="https://www.realtor.ca/..." />
                    {prop.listingUrl && (
                      <a href={prop.listingUrl} target="_blank" rel="noopener noreferrer" className="block text-xs text-amber-500 hover:text-amber-400 mb-4 -mt-2 truncate">↗ Open listing</a>
                    )}

                    <div className="h-px bg-stone-700/50 mb-4" />
                    <SelectField label="Property Type" value={prop.propertyType} onChange={v => updateProp("propertyType", v)} options={[{ value: "condo", label: "Condo / Apartment" }, { value: "townhome", label: "Townhome" }]} />
                    <InputField label="Purchase Price" prefix="$" value={prop.purchasePrice} onChange={v => updateProp("purchasePrice", v)} placeholder="800,000" />
                    <InputField label="Square Footage" suffix="sqft" value={prop.squareFootage} onChange={v => updateProp("squareFootage", v)} placeholder="650" />
                    <InputField label="Year Built" value={prop.yearBuilt} onChange={v => updateProp("yearBuilt", v)} placeholder="2005" />
                    <InputField label="Down Payment" suffix="%" value={prop.downPaymentPct} onChange={v => updateProp("downPaymentPct", v)} placeholder="20" />
                    <InputField label="Mortgage Interest Rate" suffix="%" value={prop.mortgageRate} onChange={v => updateProp("mortgageRate", v)} placeholder="5.25" />
                    <InputField label="Amortization Period" suffix="yrs" value={prop.amortization} onChange={v => updateProp("amortization", v)} placeholder="25" />

                    <div className="h-px bg-stone-700/50 mb-4" />
                    <InputField label="Monthly Strata Fees" prefix="$" value={prop.strataFees} onChange={v => updateProp("strataFees", v)} placeholder="450" />
                    <InputField label="Annual Property Tax" prefix="$" value={prop.annualPropertyTax} onChange={v => updateProp("annualPropertyTax", v)} placeholder="4,200" />
                    <InputField label="Annual Home Insurance" prefix="$" value={prop.annualHomeInsurance} onChange={v => updateProp("annualHomeInsurance", v)} placeholder="1,500" />
                    <InputField label="Monthly Maintenance Reserve" prefix="$" value={prop.maintenanceReserve} onChange={v => updateProp("maintenanceReserve", v)} placeholder="200" />
                    <InputField label="Est. Monthly Rent" prefix="$" value={prop.estimatedRent} onChange={v => updateProp("estimatedRent", v)} placeholder="2,800" hint="for metrics" />

                    <div className="h-px bg-stone-700/50 mb-4" />
                    <InputField label="Legal Fees (est.)" prefix="$" value={prop.legalFees} onChange={v => updateProp("legalFees", v)} hint="one-time" />
                    <InputField label="Home Inspection (est.)" prefix="$" value={prop.homeInspection} onChange={v => updateProp("homeInspection", v)} hint="one-time" />
                    <InputField label="Title Insurance (est.)" prefix="$" value={prop.titleInsurance} onChange={v => updateProp("titleInsurance", v)} hint="one-time" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Section 1: Upfront Costs */}
            <div className="bg-stone-900/80 border border-stone-700/60 rounded-2xl p-5">
              <SectionTitle icon="🏷️">One-Time Upfront Costs</SectionTitle>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <StatCard label="Property Transfer Tax" value={fmtDollar(calcs.ptt)} />
                <StatCard label="Legal Fees" value={fmtDollar(calcs.legalFees)} />
                <StatCard label="Home Inspection" value={fmtDollar(calcs.inspection)} />
                <StatCard label="Title Insurance" value={fmtDollar(calcs.titleIns)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl p-4 bg-stone-800/40 border border-stone-700/50">
                  <p className="text-xs text-stone-400 uppercase tracking-widest font-semibold mb-1">Closing Costs</p>
                  <p className="text-2xl font-bold text-stone-100">{fmtDollar(calcs.totalUpfrontExcludingDown)}</p>
                  <p className="text-xs text-stone-500">PTT + legal + inspection + insurance</p>
                </div>
                <div className="rounded-xl p-4 bg-amber-500/10 border border-amber-500/30">
                  <p className="text-xs text-amber-400 uppercase tracking-widest font-semibold mb-1">Total Cash Needed</p>
                  <p className="text-2xl font-bold text-amber-400">{fmtDollar(calcs.totalUpfront)}</p>
                  <p className="text-xs text-stone-500">Includes {fmtDollar(calcs.downAmt)} down ({calcs.downPct}%)</p>
                </div>
              </div>
              {calcs.price > 0 && (
                <details className="mt-3">
                  <summary className="text-xs text-stone-500 cursor-pointer hover:text-stone-300 select-none">PTT calculation details ▸</summary>
                  <div className="mt-2 text-xs text-stone-400 space-y-1 pl-2 border-l border-stone-700">
                    <div>1% on first $200,000: {fmtDollar(Math.min(calcs.price, 200000) * 0.01)}</div>
                    {calcs.price > 200000 && <div>2% on $200k–{calcs.price >= 2000000 ? "$2M" : fmtDollar(calcs.price)}: {fmtDollar((Math.min(calcs.price, 2000000) - 200000) * 0.02)}</div>}
                    {calcs.price > 2000000 && <div>3% on $2M–{calcs.price >= 3000000 ? "$3M" : fmtDollar(calcs.price)}: {fmtDollar((Math.min(calcs.price, 3000000) - 2000000) * 0.03)}</div>}
                    {calcs.price > 3000000 && <div>5% above $3M: {fmtDollar((calcs.price - 3000000) * 0.05)}</div>}
                    <div className="font-semibold text-stone-200">Total PTT: {fmtDollar(calcs.ptt)}</div>
                  </div>
                </details>
              )}
            </div>

            {/* Section 2: Monthly Cash Flow */}
            <div className="bg-stone-900/80 border border-stone-700/60 rounded-2xl p-5">
              <SectionTitle icon="📅">Monthly Cash Flow</SectionTitle>

              {/* Down Payment Slider */}
              <div className="mb-5 p-4 rounded-xl bg-stone-800/50 border border-stone-700/50">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Down Payment Scenario</p>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-amber-400">{effectiveDownPct}%</span>
                    <span className="text-xs text-stone-500 tabular-nums">{calcs.price > 0 ? fmtDollar(calcs.downAmt) : "—"}</span>
                    {sliderDownPct !== null && (
                      <button onClick={() => setSliderDownPct(null)} className="text-xs text-stone-500 hover:text-amber-400 border border-stone-600 hover:border-amber-500/50 rounded px-1.5 py-0.5 transition-colors">
                        reset to {baseDownPct}%
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="range" min="5" max="100" step="5"
                  value={effectiveDownPct}
                  onChange={e => setSliderDownPct(parseInt(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    accentColor: '#f59e0b',
                    background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${((effectiveDownPct - 5) / 95) * 100}%, #44403c ${((effectiveDownPct - 5) / 95) * 100}%, #44403c 100%)`
                  }}
                />
                <div className="relative mt-2 h-5">
                  {[5, 20, 35, 50, 65, 80, 100].map(v => (
                    <button
                      key={v}
                      onClick={() => setSliderDownPct(v)}
                      className={`absolute text-xs transition-colors -translate-x-1/2 ${effectiveDownPct === v ? "text-amber-400 font-bold" : "text-stone-600 hover:text-stone-400"}`}
                      style={{ left: `${((v - 5) / 95) * 100}%` }}
                    >{v}%</button>
                  ))}
                </div>
                {effectiveDownPct < 20 && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    <span>⚠</span><span>CMHC mortgage insurance required under 20% down</span>
                  </div>
                )}
              </div>

              {/* Mortgage breakdown */}
              <div className="mb-4">
                <p className="text-xs text-stone-500 uppercase tracking-widest mb-2 font-semibold">Mortgage Payment</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl p-3 bg-stone-800/60 border border-stone-700/50 text-center">
                    <p className="text-xs text-stone-400 mb-1">Total</p>
                    <p className="text-lg font-bold text-stone-100">{fmtDollar(calcs.mortgagePayment, 0)}</p>
                  </div>
                  <div className="rounded-xl p-3 bg-amber-500/10 border border-amber-500/20 text-center">
                    <p className="text-xs text-amber-400 mb-1">Principal ↑</p>
                    <p className="text-lg font-bold text-amber-400">{fmtDollar(calcs.mortgagePrincipal, 0)}</p>
                    <p className="text-xs text-stone-500">recoverable</p>
                  </div>
                  <div className="rounded-xl p-3 bg-red-500/10 border border-red-500/20 text-center">
                    <p className="text-xs text-red-400 mb-1">Interest ↓</p>
                    <p className="text-lg font-bold text-red-400">{fmtDollar(calcs.mortgageInterest, 0)}</p>
                    <p className="text-xs text-stone-500">non-recoverable</p>
                  </div>
                </div>
                <p className="text-xs text-stone-600 mt-1.5">* Based on month 1. Principal portion grows over time.</p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {[
                  { label: "Strata Fees", val: calcs.strataFees },
                  { label: "Property Tax", val: calcs.propTax },
                  { label: "Home Insurance", val: calcs.insurance },
                  { label: "Maintenance", val: calcs.maintenance },
                ].map(({ label, val }) => (
                  <div key={label} className="rounded-lg p-3 bg-red-500/10 border border-red-500/20">
                    <p className="text-xs text-stone-400 mb-1">{label}</p>
                    <p className="text-base font-bold text-red-300">{fmtDollar(val, 0)}/mo</p>
                    <p className="text-xs text-stone-500">non-rec</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl p-4 bg-stone-800/40 border border-stone-700/50">
                  <p className="text-xs text-stone-400 uppercase tracking-widest font-semibold mb-1">Total Monthly Cost</p>
                  <p className="text-2xl font-bold text-stone-100">{fmtDollar(calcs.totalMonthly, 0)}</p>
                  <p className="text-xs text-stone-500">{fmtDollar(calcs.totalMonthly * 12, 0)}/year</p>
                </div>
                <div className="rounded-xl p-4 bg-red-500/10 border border-red-500/30">
                  <p className="text-xs text-red-400 uppercase tracking-widest font-semibold mb-1">Non-Recoverable</p>
                  <p className="text-2xl font-bold text-red-400">{fmtDollar(calcs.totalNonRecoverable, 0)}</p>
                  <p className="text-xs text-stone-500">{fmtDollar(calcs.totalNonRecoverable * 12, 0)}/year</p>
                </div>
              </div>
            </div>

            {/* Section 3: Property Metrics */}
            <div className="bg-stone-900/80 border border-stone-700/60 rounded-2xl p-5">
              <SectionTitle icon="🔍">Property Metrics</SectionTitle>
              {hasMetrics ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {calcs.sqft > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-2">Per Square Foot</p>
                      <div className="rounded-xl border border-stone-700/50 overflow-hidden divide-y divide-stone-700/40">
                        <MetricRow label="Price / sqft" value={fmtDollar(calcs.pricePerSqft, 0)} context={`${fmtDollar(calcs.benchmarkPPSF)} avg`} status={calcs.priceVsBenchmark === null ? null : calcs.priceVsBenchmark <= -5 ? "good" : calcs.priceVsBenchmark >= 15 ? "bad" : "warn"} />
                        {calcs.priceVsBenchmark !== null && <MetricRow label="vs Vancouver avg" value={`${calcs.priceVsBenchmark > 0 ? "+" : ""}${fmt(calcs.priceVsBenchmark, 1)}%`} context={prop.propertyType === "condo" ? "condo" : "townhome"} status={calcs.priceVsBenchmark <= -5 ? "good" : calcs.priceVsBenchmark >= 15 ? "bad" : "warn"} />}
                        {calcs.strataPerSqft > 0 && <MetricRow label="Strata / sqft" value={`$${fmt(calcs.strataPerSqft, 2)}`} context={`$${VANCOUVER_BENCHMARKS.strataPerSqft.toFixed(2)} avg`} status={calcs.strataPerSqft <= VANCOUVER_BENCHMARKS.strataPerSqft ? "good" : calcs.strataPerSqft > VANCOUVER_BENCHMARKS.strataPerSqft * 1.4 ? "bad" : "warn"} />}
                        <MetricRow label="Monthly cost / sqft" value={`$${fmt(calcs.totalMonthly / calcs.sqft, 2)}`} context="all-in" />
                        {calcs.buildingAge !== null && <MetricRow label="Building age" value={`${calcs.buildingAge} yrs`} context={`Built ${prop.yearBuilt}`} status={calcs.buildingAge <= 10 ? "good" : calcs.buildingAge >= 40 ? "warn" : null} />}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-2">{calcs.estimatedRent > 0 ? "Investment Metrics" : "Financing Metrics"}</p>
                    <div className="rounded-xl border border-stone-700/50 overflow-hidden divide-y divide-stone-700/40">
                      <MetricRow label="LTV Ratio" value={`${fmt(calcs.effectiveLTV, 1)}%`} context={calcs.effectiveLTV <= 80 ? "no CMHC" : "CMHC required"} status={calcs.effectiveLTV <= 80 ? "good" : "warn"} />
                      {calcs.price > 0 && <MetricRow label="Non-rec / price" value={`${fmt((calcs.totalNonRecoverable / calcs.price) * 100, 3)}%`} context="monthly carry rate" />}
                      {calcs.estimatedRent > 0 ? (
                        <>
                          <MetricRow label="Gross Rent Multiplier" value={`${fmt(calcs.grossRentMultiplier, 1)}×`} context="lower = better" status={calcs.grossRentMultiplier < 20 ? "good" : calcs.grossRentMultiplier > 30 ? "bad" : "warn"} />
                          <MetricRow label="Cap Rate" value={`${fmt(calcs.capRate, 2)}%`} context={`${VANCOUVER_BENCHMARKS.avgCapRate.toFixed(1)}% avg`} status={calcs.capRate >= VANCOUVER_BENCHMARKS.avgCapRate ? "good" : calcs.capRate < VANCOUVER_BENCHMARKS.avgCapRate * 0.7 ? "bad" : "warn"} />
                          <MetricRow label="Rent vs non-rec" value={calcs.rentVsNonRec > 0 ? `${fmtDollar(calcs.rentVsNonRec)} shortfall` : `${fmtDollar(Math.abs(calcs.rentVsNonRec || 0))} surplus`} context="/month" status={calcs.rentVsNonRec !== null ? (calcs.rentVsNonRec <= 0 ? "good" : calcs.rentVsNonRec > 1000 ? "bad" : "warn") : null} />
                        </>
                      ) : (
                        <div className="px-4 py-3 text-xs text-stone-600 italic">Add estimated monthly rent to unlock investment metrics</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-stone-700/50 p-6 text-center">
                  <p className="text-stone-500 text-sm mb-1">No metrics available yet</p>
                  <p className="text-xs text-stone-600">Add <span className="text-amber-500/80">square footage</span> or <span className="text-amber-500/80">estimated rent</span> to unlock insights.</p>
                </div>
              )}
              {calcs.price > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-3">
                  <StatCard label="Down Payment" value={`${calcs.downPct}%`} sub={fmtDollar(calcs.downAmt)} good={calcs.downPct >= 20} warn={calcs.downPct < 20} />
                  <StatCard label="Loan Amount" value={fmtDollar(calcs.loanAmt)} sub={`${fmt(calcs.effectiveLTV, 1)}% LTV`} />
                  <StatCard label="Non-Rec Annual" value={fmtDollar(calcs.totalNonRecoverable * 12)} sub="true annual cost" accent />
                </div>
              )}
            </div>

            {/* Section 4: Summary */}
            <div className="bg-stone-900/80 border border-stone-700/60 rounded-2xl p-5">
              <SectionTitle icon="📊">Summary</SectionTitle>
              <BarChart total={calcs.totalMonthly} nonRecoverable={calcs.totalNonRecoverable} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                <StatCard label="Monthly Total" value={fmtDollar(calcs.totalMonthly, 0)} sub="all-in" />
                <StatCard label="Monthly Non-Rec" value={fmtDollar(calcs.totalNonRecoverable, 0)} sub="true cost" accent />
                <StatCard label="Annual Total" value={fmtDollar(calcs.totalMonthly * 12, 0)} sub="projected" />
                <StatCard label="Annual Non-Rec" value={fmtDollar(calcs.totalNonRecoverable * 12, 0)} sub="projected" accent />
              </div>
              {calcs.price > 0 && (
                <div className="mt-4 p-3 rounded-xl bg-stone-800/40 border border-stone-700/40">
                  <p className="text-xs text-stone-400 font-semibold uppercase tracking-widest mb-2">Quick Facts</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-stone-400">
                    <div>Loan amount: <span className="text-stone-200 font-medium">{fmtDollar(calcs.loanAmt)}</span></div>
                    <div>Down payment: <span className="text-stone-200 font-medium">{fmtDollar(calcs.downAmt)} ({calcs.downPct}%)</span></div>
                    <div>Closing costs: <span className="text-stone-200 font-medium">{fmtDollar(calcs.totalUpfrontExcludingDown)}</span></div>
                    <div>PTT: <span className="text-stone-200 font-medium">{fmtDollar(calcs.ptt)}</span></div>
                    <div>Mortgage (mo 1): <span className="text-stone-200 font-medium">{fmtDollar(calcs.mortgagePayment, 0)}/mo</span></div>
                    <div>Total cash to close: <span className="text-amber-400 font-semibold">{fmtDollar(calcs.totalUpfront)}</span></div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        <p className="text-center text-xs text-stone-600 mt-6">
          For informational purposes only. Consult a mortgage broker and financial advisor. PTT rates current as of 2024. Vancouver benchmarks are approximate.
        </p>
      </div>
    </div>
  );
}

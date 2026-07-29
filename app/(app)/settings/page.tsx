"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/Toast";
import { VOICELEDGER_CATEGORIES } from "../../../lib/voiceledger";
import type { IncomeSource } from "../../../lib/voiceledger";
import BankConnections from "../../../components/BankConnections";
import { getOrCreateBusiness } from "../../../lib/business";

const INPUT = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500";

export default function SettingsPage() {
  const { toast } = useToast();
  const [business, setBusiness] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("sole_trader");
  const [baseCurrency, setBaseCurrency] = useState("GBP");
  const [taxRate, setTaxRate] = useState<number>(25);
  const [taxYearStart, setTaxYearStart] = useState("");
  const [taxYearEnd, setTaxYearEnd] = useState("");
  const [exportFormat, setExportFormat] = useState("csv");
  const [categories, setCategories] = useState(VOICELEDGER_CATEGORIES.join("\n"));
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [addingSource, setAddingSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<"self_employment" | "uk_property">("self_employment");
  const [newSourceElection, setNewSourceElection] = useState<"calendar" | "tax_year">("calendar");

  const load = async () => {
    setLoading(true);
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) { setLoading(false); return; }

    try {
      const data = await getOrCreateBusiness(user.id, user.email);
      setBusiness(data);
      setName(data.name ?? "");
      setBusinessType(data.business_type ?? "sole_trader");
      setBaseCurrency(data.base_currency ?? "GBP");
      setTaxRate(Number(data.corporation_tax_rate ?? 25));
      setTaxYearStart(data.tax_year_start ?? "");
      setTaxYearEnd(data.tax_year_end ?? "");
      setExportFormat(data.export_preferences?.format ?? "csv");

      const { data: categoryRows } = await supabase.from("categories").select("name").eq("business_id", data.id).order("name");
      if (categoryRows?.length) setCategories(categoryRows.map((row) => row.name).join("\n"));
      const { data: sourceRows } = await supabase.from("income_sources").select("*").eq("business_id", data.id).order("created_at");
      if (sourceRows) setIncomeSources(sourceRows as IncomeSource[]);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load your business settings", "error");
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addIncomeSource = async () => {
    if (!newSourceName.trim() || !business?.id) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const { data, error } = await supabase.from("income_sources").insert({
      user_id: user.id,
      business_id: business.id,
      name: newSourceName.trim(),
      source_type: newSourceType,
      quarter_election: newSourceElection,
    }).select().single();
    if (error) { toast(error.message, "error"); return; }
    setIncomeSources(prev => [...prev, data as IncomeSource]);
    setNewSourceName("");
    setAddingSource(false);
    toast("Income source added", "success");
  };

  const save = async () => {
    setLoading(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Not authenticated");

      const payload = {
        base_currency: baseCurrency.toUpperCase(), business_type: businessType,
        corporation_tax_rate: taxRate, export_preferences: { format: exportFormat },
        name, owner_id: user.id, tax_year_end: taxYearEnd || null, tax_year_start: taxYearStart || null
      };

      const { data, error } = business
        ? await supabase.from("businesses").update(payload).eq("id", business.id).select().single()
        : await supabase.from("businesses").insert(payload).select().single();
      if (error) throw error;
      setBusiness(data);

      const nextCategories = categories.split("\n").map((item) => item.trim()).filter(Boolean);
      if (nextCategories.length) {
        const { data: existing } = await supabase.from("categories").select("name").eq("business_id", data.id);
        const existingNames = new Set((existing ?? []).map((row) => row.name));
        const inserts = nextCategories.filter((item) => !existingNames.has(item)).map((item) => ({ business_id: data.id, name: item }));
        if (inserts.length) await supabase.from("categories").insert(inserts);
      }

      toast("Settings saved", "success");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      toast(error instanceof Error ? error.message : "Save failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-bold text-stone-900" style={{ fontFamily: "Georgia, serif" }}>Settings</h1>
        <p className="muted text-sm">Configure business defaults used across estimates, imports, and exports.</p>
      </div>

      {loading ? <div className="card muted">Loading...</div> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <BankConnections />
          <section className="card space-y-4">
            <h2 className="font-semibold text-stone-900">Business profile</h2>
            <label className="block text-sm font-medium text-stone-700">
              Business name
              <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
            </label>
            <label className="block text-sm font-medium text-stone-700">
              Business type
              <select value={businessType} onChange={(e) => setBusinessType(e.target.value)} className={INPUT}>
                <option value="limited_company">UK limited company</option>
                <option value="sole_trader">Sole trader</option>
                <option value="freelancer">Freelancer</option>
                <option value="startup">Startup</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-stone-700">
              Base currency
              <input value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value.slice(0, 3))} className={`${INPUT} uppercase`} />
            </label>
          </section>

          <section className="card space-y-4">
            <h2 className="font-semibold text-stone-900">Tax estimate</h2>
            {businessType === "limited_company" ? (
              <label className="block text-sm font-medium text-stone-700">
                Corporation tax estimate rate (%)
                <input value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} type="number" min="0" step="0.1" className={INPUT} />
              </label>
            ) : (
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                <p className="font-medium">Income tax estimate (band-aware)</p>
                <p className="mt-1 text-xs text-stone-500">Personal allowance: £12,570 · Basic rate 20% to £50,270 · Higher rate 40% to £125,140 · Additional rate 45% above. Estimate excludes Class 2/4 NI.</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-stone-700">
                Tax year start
                <input value={taxYearStart} onChange={(e) => setTaxYearStart(e.target.value)} type="date" className={INPUT} />
              </label>
              <label className="block text-sm font-medium text-stone-700">
                Tax year end
                <input value={taxYearEnd} onChange={(e) => setTaxYearEnd(e.target.value)} type="date" className={INPUT} />
              </label>
            </div>
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Planning estimate only. Not tax, accounting, or legal advice. Always confirm with a qualified accountant or HMRC guidance.
            </p>
          </section>

          {/* Income sources — sole traders / landlords only */}
          {(businessType === "sole_trader" || businessType === "freelancer") && (
            <section className="card space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-stone-900">Income sources</h2>
                  <p className="text-xs muted mt-0.5">MTD ITSA requires a separate quarterly submission per income stream.</p>
                </div>
                {!addingSource && (
                  <button onClick={() => setAddingSource(true)} className="btn btn-accent px-4 py-2 text-xs font-semibold shadow-sm">
                    + Add source
                  </button>
                )}
              </div>

              {incomeSources.length === 0 && !addingSource && (
                <p className="text-sm muted">No income sources yet. Add one to prepare for MTD quarterly updates.</p>
              )}

              {incomeSources.map((src) => (
                <div key={src.id} className="flex items-start justify-between rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-900">{src.name}</p>
                    <p className="text-xs muted mt-0.5">
                      {src.source_type === "self_employment" ? "Self-employment" : "UK property"}{" · "}
                      {src.quarter_election === "calendar" ? "Calendar quarters (Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar)" : "Tax-year quarters (Apr–Jul / Jul–Oct / Oct–Jan / Jan–Apr)"}
                    </p>
                  </div>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">{src.reporting_basis}</span>
                </div>
              ))}

              {addingSource && (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
                  <p className="text-sm font-semibold text-stone-900">New income source</p>
                  <label className="block text-sm font-medium text-stone-700">
                    Name (e.g. "Freelance design", "123 High Street letting")
                    <input value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} placeholder="Business or property name" className={INPUT} />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-sm font-medium text-stone-700">
                      Type
                      <select value={newSourceType} onChange={(e) => setNewSourceType(e.target.value as "self_employment" | "uk_property")} className={INPUT}>
                        <option value="self_employment">Self-employment</option>
                        <option value="uk_property">UK property</option>
                      </select>
                    </label>
                    <label className="block text-sm font-medium text-stone-700">
                      Quarter election
                      <select value={newSourceElection} onChange={(e) => setNewSourceElection(e.target.value as "calendar" | "tax_year")} className={INPUT}>
                        <option value="calendar">Calendar quarters</option>
                        <option value="tax_year">Tax-year quarters</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={addIncomeSource} className="btn btn-accent px-4 py-2 text-xs font-semibold">Save</button>
                    <button onClick={() => { setAddingSource(false); setNewSourceName(""); }} className="btn px-4 py-2 text-xs font-medium text-stone-600 border border-stone-300 bg-white">Cancel</button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="card space-y-4">
            <h2 className="font-semibold text-stone-900">Categories</h2>
            <p className="text-xs muted">One category per line. These are used for categorising transactions.</p>
            <textarea value={categories} onChange={(e) => setCategories(e.target.value)} rows={12}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-mono text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          </section>

          <section className="card space-y-4">
            <h2 className="font-semibold text-stone-900">Export preferences</h2>
            <label className="block text-sm font-medium text-stone-700">
              Default export format
              <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} className={INPUT}>
                <option value="csv">CSV</option>
                <option value="pdf_later">PDF later</option>
              </select>
            </label>
            <button onClick={save} className="btn btn-accent px-6 py-2.5 font-semibold shadow-sm">
              Save settings
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LayoutTemplate, Plus } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import Modal from "@/components/Modal";
import AdminOnly from "@/components/admin/AdminOnly";
import TemplateMetaFields from "@/components/admin/TemplateMetaFields";
import TemplateStatusChips from "@/components/admin/TemplateStatusChips";
import TemplateThumb from "@/components/templates/TemplateThumb";
import {
  apiAdminCreateDomain,
  apiAdminCreateTemplate,
  apiAdminListDomains,
  apiAdminListTemplates,
  apiAdminUpdateDomain,
} from "@/lib/api";
import { AdminTemplate, Domain, TemplateMetaInput } from "@/lib/types";

type Tab = "templates" | "domains";

const EMPTY_META: TemplateMetaInput = { name: "", domain_id: "", description: "", icon: "generic", color: "#4f46e5" };

export default function TemplateStudioPage() {
  return (
    <>
      <TopBar title="Template Studio" />
      <div className="app-content">
        <AdminOnly>
          <TemplateStudio />
        </AdminOnly>
      </div>
    </>
  );
}

function TemplateStudio() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("templates");
  const [templates, setTemplates] = useState<AdminTemplate[] | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newMeta, setNewMeta] = useState<TemplateMetaInput>(EMPTY_META);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([apiAdminListTemplates(), apiAdminListDomains()]);
      setTemplates(t);
      setDomains(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTemplates((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const created = await apiAdminCreateTemplate(newMeta);
      router.push(`/admin/templates/${encodeURIComponent(created.template.template_id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="tabs flex-1" role="tablist">
          {(["templates", "domains"] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab-btn${tab === id ? " active" : ""}`}
              onClick={() => setTab(id)}
            >
              {id === "templates" ? "Templates" : "Domains"}
            </button>
          ))}
        </div>
        {tab === "templates" && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setNewMeta({ ...EMPTY_META, domain_id: domains.find((d) => d.is_active)?.domain_id ?? "" });
              setCreating(true);
            }}
          >
            <Plus size={16} /> New template
          </button>
        )}
      </div>

      <ErrorBanner message={error} />

      {tab === "templates" ? (
        templates === null ? (
          <div className="studio-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 120 }} />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div className="card empty-state">
            <div className="empty-state-icon">
              <LayoutTemplate size={22} />
            </div>
            <p className="m-0 font-medium" style={{ color: "var(--color-text)" }}>
              No templates yet. Create one, or run the setup script to load the starter templates.
            </p>
          </div>
        ) : (
          <div className="studio-grid">
            {templates.map((t) => (
              <Link key={t.template_id} href={`/admin/templates/${encodeURIComponent(t.template_id)}`} className={`studio-card${t.status === "RETIRED" ? " is-retired" : ""}`}>
                <TemplateThumb icon={t.icon} color={t.color} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="template-card-name">{t.name}</span>
                  <span className="template-card-domain">{t.domain_name}</span>
                  <TemplateStatusChips template={t} />
                </span>
              </Link>
            ))}
          </div>
        )
      ) : (
        <DomainsPanel domains={domains} onChanged={reload} onError={setError} />
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={<div className="modal-title-text">New template</div>}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || newMeta.name.trim().length < 2 || !newMeta.domain_id}
              onClick={handleCreate}
            >
              Create draft
            </button>
          </>
        }
      >
        <TemplateMetaFields value={newMeta} domains={domains} disabled={busy} onChange={setNewMeta} />
        <p className="studio-hint mt-4 mb-0">It starts as an unpublished draft — users only see it once you publish it.</p>
      </Modal>
    </>
  );
}

function DomainsPanel({ domains, onChanged, onError }: { domains: Domain[]; onChanged: () => Promise<void>; onError: (m: string | null) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await action();
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm" style={{ color: "var(--color-text-muted)" }}>
        The list users choose from when they start a blank request. Hiding a domain removes it from that list; it&apos;s never
        deleted, and past projects keep it.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await apiAdminCreateDomain(name);
            setName("");
          });
        }}
      >
        <input
          className="field-input"
          style={{ maxWidth: 320 }}
          maxLength={60}
          placeholder="New domain, e.g. Agritech"
          aria-label="New domain name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>
          <Plus size={16} /> Add domain
        </button>
      </form>
      <div className="panel p-0">
        <table className="studio-table">
          <thead>
            <tr>
              <th>Domain</th>
              <th style={{ width: 120 }}>Order</th>
              <th style={{ width: 150 }}>Shown to users</th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => {
              const draftName = editing[d.domain_id];
              return (
                <tr key={d.domain_id} className={d.is_active ? undefined : "is-hidden"}>
                  <td>
                    <input
                      className="field-input"
                      maxLength={60}
                      value={draftName ?? d.name}
                      disabled={busy}
                      aria-label={`Name of ${d.name}`}
                      onChange={(e) => setEditing((prev) => ({ ...prev, [d.domain_id]: e.target.value }))}
                      onBlur={() => {
                        if (draftName === undefined || draftName.trim() === d.name) return;
                        run(async () => {
                          await apiAdminUpdateDomain(d.domain_id, { name: draftName });
                          setEditing((prev) => {
                            const next = { ...prev };
                            delete next[d.domain_id];
                            return next;
                          });
                        });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className="field-input"
                      min={0}
                      max={10000}
                      defaultValue={d.sort_order}
                      disabled={busy}
                      aria-label={`Order of ${d.name}`}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value !== d.sort_order) run(() => apiAdminUpdateDomain(d.domain_id, { sort_order: value }));
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      disabled={busy}
                      onClick={() => run(() => apiAdminUpdateDomain(d.domain_id, { is_active: !d.is_active }))}
                    >
                      {d.is_active ? <Eye size={14} /> : <EyeOff size={14} />} {d.is_active ? "Shown" : "Hidden"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {domains.length === 0 && (
              <tr>
                <td colSpan={3} className="doc-empty">
                  No domains yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

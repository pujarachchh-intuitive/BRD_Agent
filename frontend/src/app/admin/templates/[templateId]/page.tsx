"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ArrowLeft, Eye, Info, Rocket, Save, Undo2 } from "lucide-react";
import TopBar from "@/components/layout/TopBar";
import ErrorBanner from "@/components/ErrorBanner";
import Modal from "@/components/Modal";
import AdminOnly from "@/components/admin/AdminOnly";
import TemplateContentEditor from "@/components/admin/TemplateContentEditor";
import TemplateMetaFields from "@/components/admin/TemplateMetaFields";
import TemplateStatusChips from "@/components/admin/TemplateStatusChips";
import TemplateContentView, { itemSummary } from "@/components/templates/TemplateContentView";
import TemplateThumb from "@/components/templates/TemplateThumb";
import {
  apiAdminGetTemplate,
  apiAdminGetVersion,
  apiAdminListDomains,
  apiAdminPublish,
  apiAdminRestoreVersion,
  apiAdminSaveDraft,
  apiAdminSetTemplateStatus,
  apiAdminTemplateSchema,
  apiAdminUpdateTemplate,
} from "@/lib/api";
import { AdminTemplateDetail, Domain, TemplateContent, TemplateItem, TemplateMetaInput, TemplateSchema, TemplateVersion } from "@/lib/types";

type Tab = "content" | "details" | "versions";

const EMPTY_CONTENT: TemplateContent = { domain_guidance: "", questions: [], items: {} };

function contentOf(detail: AdminTemplateDetail): TemplateContent {
  return detail.draft?.content ?? detail.published?.content ?? EMPTY_CONTENT;
}

function metaOf(detail: AdminTemplateDetail): TemplateMetaInput {
  const { name, domain_id, description, icon, color } = detail.template;
  return { name, domain_id, description, icon, color };
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** What changed in `next` compared with `base`, by item key. */
function compareContent(base: TemplateContent | null, next: TemplateContent) {
  const flat = (c: TemplateContent | null) => {
    const map = new Map<string, { field: string; item: TemplateItem }>();
    for (const [field, items] of Object.entries(c?.items ?? {})) for (const item of items) map.set(item.key, { field, item });
    return map;
  };
  const before = flat(base);
  const after = flat(next);
  const marks: Record<string, "added" | "changed"> = {};
  for (const [key, { item }] of after) {
    const old = before.get(key);
    if (!old) marks[key] = "added";
    else if (JSON.stringify(old.item) !== JSON.stringify(item)) marks[key] = "changed";
  }
  const removed = [...before.entries()].filter(([key]) => !after.has(key)).map(([, v]) => v);
  return { marks, removed };
}

export default function TemplateEditorPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = use(params);
  return (
    <AdminOnly>
      <TemplateEditor templateId={templateId} />
    </AdminOnly>
  );
}

function TemplateEditor({ templateId }: { templateId: string }) {
  const [detail, setDetail] = useState<AdminTemplateDetail | null>(null);
  const [schema, setSchema] = useState<TemplateSchema | null>(null);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [working, setWorking] = useState<TemplateContent>(EMPTY_CONTENT);
  const [savedJson, setSavedJson] = useState(JSON.stringify(EMPTY_CONTENT));
  const [meta, setMeta] = useState<TemplateMetaInput | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const [tab, setTab] = useState<Tab>("content");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [viewing, setViewing] = useState<TemplateVersion | null>(null);

  const adopt = useCallback((next: AdminTemplateDetail) => {
    setDetail(next);
    const content = contentOf(next);
    setWorking(content);
    setSavedJson(JSON.stringify(content));
    setMeta(metaOf(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiAdminGetTemplate(templateId), apiAdminTemplateSchema(), apiAdminListDomains()])
      .then(([d, s, doms]) => {
        if (cancelled) return;
        adopt(d);
        setSchema(s);
        setDomains(doms);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [templateId, adopt]);

  const dirty = JSON.stringify(working) !== savedJson;
  const metaDirty = !!detail && !!meta && JSON.stringify(meta) !== JSON.stringify(metaOf(detail));

  useEffect(() => {
    if (!dirty && !metaDirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, metaDirty]);

  async function run(action: () => Promise<AdminTemplateDetail>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      adopt(await action());
      setNotice(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    const ok = await run(() => apiAdminSaveDraft(templateId, working, changeNote), "Draft saved. Users still see the published version until you publish.");
    if (ok) setChangeNote("");
  }

  async function handlePublish() {
    const ok = await run(() => apiAdminPublish(templateId, changeNote), "Published. New requests now use this version.");
    if (ok) {
      setChangeNote("");
      setPublishing(false);
    }
  }

  async function handleRestore(version: number) {
    const message = detail?.draft
      ? `Copy version ${version} into the draft? This replaces the current draft's content (version ${detail.draft.version}). Published versions are not changed.`
      : `Copy version ${version} into a new draft? Published versions are not changed; you can review it and then publish.`;
    if (!window.confirm(message)) return;
    setViewing(null);
    const ok = await run(() => apiAdminRestoreVersion(templateId, version), `Version ${version} copied into the draft. Review it, then publish.`);
    if (ok) setTab("content");
  }

  async function handleView(version: number) {
    setError(null);
    try {
      setViewing(await apiAdminGetVersion(templateId, version));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStatus() {
    if (!detail) return;
    const retiring = detail.template.status === "ACTIVE";
    if (retiring && !window.confirm("Retire this template? Users can no longer start from it. Nothing is deleted, and you can reactivate it any time.")) return;
    await run(() => apiAdminSetTemplateStatus(templateId, retiring ? "retire" : "reactivate"), retiring ? "Template retired." : "Template reactivated.");
  }

  const viewingDiff = useMemo(
    () => (viewing && detail ? compareContent(detail.published?.content ?? null, viewing.content) : null),
    [viewing, detail]
  );

  if (!detail || !schema || !meta) {
    return (
      <>
        <TopBar title="Template Studio" />
        <div className="app-content">
          <ErrorBanner message={error} />
          {!error && <div className="skeleton" style={{ height: 320 }} />}
        </div>
      </>
    );
  }

  const t = detail.template;
  const nextVersion = detail.draft?.version ?? Math.max(0, ...detail.versions.map((v) => v.version)) + 1;
  const canPublish = !!detail.draft && !dirty && !busy && t.status === "ACTIVE";
  const itemCount = Object.values(working.items).reduce((sum, list) => sum + list.length, 0);

  return (
    <>
      <TopBar
        title={t.name}
        actions={
          <>
            <TemplateStatusChips template={t} />
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={handleStatus}>
              {t.status === "ACTIVE" ? <Archive size={14} /> : <ArchiveRestore size={14} />}
              {t.status === "ACTIVE" ? "Retire" : "Reactivate"}
            </button>
          </>
        }
      />
      <div className="app-content">
        <Link href="/admin/templates" className="back-link">
          <ArrowLeft size={14} /> All templates
        </Link>

        <div className="studio-header">
          <TemplateThumb icon={meta.icon} color={meta.color} />
          <div className="min-w-0 flex-1">
            <div className="template-card-domain">{t.domain_name}</div>
            <p className="m-0" style={{ color: "var(--color-text-muted)" }}>
              {t.description || "No description yet."}
            </p>
          </div>
        </div>

        <div className="tabs mb-5" role="tablist">
          {(["content", "details", "versions"] as Tab[]).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab-btn${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
              {id === "content" ? `Content${dirty ? " •" : ""}` : id === "details" ? `Details${metaDirty ? " •" : ""}` : `Versions (${detail.versions.length})`}
            </button>
          ))}
        </div>

        <ErrorBanner message={error} />
        {notice && !error && <div className="studio-notice">{notice}</div>}

        {tab === "content" && (
          <>
            <div className="studio-actionbar">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                  {detail.draft ? `Editing draft v${detail.draft.version}` : `Changes will be saved as draft v${nextVersion}`}
                  {dirty ? " · unsaved changes" : ""}
                </span>
                <span className="studio-hint">
                  {itemCount} item{itemCount === 1 ? "" : "s"}.{" "}
                  {t.published_version ? `Users see published v${t.published_version} until you publish.` : "Not visible to users until published."}
                </span>
              </div>
              <input
                className="field-input"
                style={{ maxWidth: 280 }}
                maxLength={300}
                placeholder="What changed? (optional)"
                aria-label="Change note"
                value={changeNote}
                disabled={busy}
                onChange={(e) => setChangeNote(e.target.value)}
              />
              <button type="button" className="btn btn-secondary" disabled={busy || !dirty} onClick={handleSaveDraft}>
                <Save size={15} /> Save draft
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canPublish}
                title={dirty ? "Save the draft first" : !detail.draft ? "There's no draft to publish" : undefined}
                onClick={() => setPublishing(true)}
              >
                <Rocket size={15} /> Publish
              </button>
            </div>
            {dirty && (
              <div className="mb-4 flex justify-end">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => window.confirm("Discard your unsaved changes?") && setWorking(JSON.parse(savedJson))}
                >
                  <Undo2 size={14} /> Discard unsaved changes
                </button>
              </div>
            )}
            <TemplateContentEditor content={working} fields={schema.fields} disabled={busy} onChange={setWorking} />
          </>
        )}

        {tab === "details" && (
          <div className="panel flex max-w-xl flex-col gap-4">
            <TemplateMetaFields value={meta} domains={domains} disabled={busy} onChange={setMeta} />
            <p className="studio-hint m-0">Details apply straight away (they aren&apos;t versioned).</p>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !metaDirty || meta.name.trim().length < 2}
                onClick={() => run(() => apiAdminUpdateTemplate(templateId, meta), "Details saved.")}
              >
                <Save size={15} /> Save details
              </button>
            </div>
          </div>
        )}

        {tab === "versions" && (
          <div className="panel p-0">
            <table className="studio-table">
              <thead>
                <tr>
                  <th style={{ width: 90 }}>Version</th>
                  <th style={{ width: 130 }}>Status</th>
                  <th>Note</th>
                  <th style={{ width: 190 }}>Published</th>
                  <th style={{ width: 230 }} />
                </tr>
              </thead>
              <tbody>
                {detail.versions.map((v) => (
                  <tr key={v.version}>
                    <td className="font-semibold">v{v.version}</td>
                    <td>
                      {v.status === "DRAFT" ? (
                        <span className="chip chip-warn">Draft</span>
                      ) : v.version === t.published_version ? (
                        <span className="chip chip-success">Live</span>
                      ) : (
                        <span className="chip chip-neutral">Earlier</span>
                      )}
                    </td>
                    <td>{v.change_note || <span className="doc-empty">—</span>}</td>
                    <td>{formatWhen(v.published_at)}</td>
                    <td>
                      <span className="flex justify-end gap-1.5">
                        <button type="button" className="btn btn-ghost btn-small" onClick={() => handleView(v.version)}>
                          <Eye size={14} /> View
                        </button>
                        {v.status === "PUBLISHED" && v.version !== t.published_version && (
                          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => handleRestore(v.version)}>
                            <Undo2 size={14} /> Restore
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="studio-hint m-0 px-4 py-3">
              Published versions are never changed or deleted. Restoring copies an earlier version into the draft; publishing it
              then makes it the newest version.
            </p>
          </div>
        )}
      </div>

      <Modal
        open={publishing}
        onClose={() => setPublishing(false)}
        title={<div className="modal-title-text">Publish draft v{detail.draft?.version}</div>}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPublishing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!canPublish} onClick={handlePublish}>
              <Rocket size={15} /> Publish
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0">
            Every new request that uses <strong>{t.name}</strong> will get this version. Runs already generated keep the version
            they used{t.published_version ? `, and v${t.published_version} stays in the history` : ""}.
          </p>
          <div className="template-disclaimer">
            <Info size={15} className="mt-0.5 flex-shrink-0" />
            <span>Check that every item marked Regulatory names its source, and that nothing states a rule or number you&apos;re not sure of.</span>
          </div>
          <div className="studio-field">
            <label htmlFor="publish-note">Change note</label>
            <input
              id="publish-note"
              className="field-input"
              maxLength={300}
              placeholder={detail.draft?.change_note || "What changed in this version?"}
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={viewing !== null}
        size="lg"
        onClose={() => setViewing(null)}
        title={
          viewing && (
            <div>
              <div className="modal-title-text">
                {t.name} · v{viewing.version}
              </div>
              <div className="modal-subtitle">
                {viewing.status === "DRAFT" ? "Draft" : `Published ${formatWhen(viewing.published_at)}`}
                {detail.published && viewing.version !== detail.published.version ? ` · compared with live v${detail.published.version}` : ""}
              </div>
            </div>
          )
        }
        footer={
          viewing?.status === "PUBLISHED" && viewing.version !== t.published_version ? (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => handleRestore(viewing.version)}>
              <Undo2 size={14} /> Restore into draft
            </button>
          ) : undefined
        }
      >
        {viewing && viewingDiff && (
          <div className="flex flex-col gap-4">
            {viewing.content.domain_guidance && (
              <details className="evidence-list">
                <summary>Guidance for the AI</summary>
                <p className="mt-2 mb-0 whitespace-pre-wrap text-sm">{viewing.content.domain_guidance}</p>
              </details>
            )}
            {viewingDiff.removed.length > 0 && detail.published && viewing.version !== detail.published.version && (
              <div className="template-disclaimer is-warn">
                <Info size={15} className="mt-0.5 flex-shrink-0" />
                <span>
                  Live v{detail.published.version} has {viewingDiff.removed.length} item{viewingDiff.removed.length === 1 ? "" : "s"} not in this version:{" "}
                  {viewingDiff.removed.map(({ field, item }) => itemSummary(field, item).title).join("; ")}
                </span>
              </div>
            )}
            <TemplateContentView
              content={viewing.content}
              marks={detail.published && viewing.version !== detail.published.version ? viewingDiff.marks : undefined}
            />
          </div>
        )}
      </Modal>
    </>
  );
}

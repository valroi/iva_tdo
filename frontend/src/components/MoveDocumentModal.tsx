import { Alert, App, Descriptions, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { moveMdr, previewMdrMove, type MdrMovePreview } from "../api";
import type { MDRRecord } from "../types";
import { getRuStatusLabel } from "../utils/revisionHints";

const TOP_LEVEL = "__top__";

interface Props {
  open: boolean;
  /** Документ, который переносим. */
  doc: MDRRecord | null;
  /** Документы проекта — из них выбирается головной. */
  projectDocs: MDRRecord[];
  /**
   * Цель, заданная перетаскиванием в дереве: id головного документа,
   * null — верхний уровень, undefined — выбрать в самой модалке.
   */
  presetParentId?: number | null;
  onClose: () => void;
  onMoved: () => Promise<void> | void;
}

/**
 * Перенос документа во вложенные к другому документу или на верхний уровень.
 *
 * Перед подтверждением показывает, что изменится: активную ревизию и состав
 * ревьюверов до и после — у вложенного он берётся от головного документа,
 * так что перенос посреди рассмотрения передаёт текущий круг другим людям.
 * Шифр документа не меняется.
 */
export default function MoveDocumentModal({ open, doc, projectDocs, presetParentId, onClose, onMoved }: Props): JSX.Element {
  const { message } = App.useApp();
  const [target, setTarget] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<MdrMovePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  // При открытии подставляем цель из перетаскивания, иначе ждём выбора.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setPreviewError(null);
    if (presetParentId === undefined) setTarget(undefined);
    else setTarget(presetParentId === null ? TOP_LEVEL : String(presetParentId));
  }, [open, presetParentId, doc?.id]);

  const options = useMemo(() => {
    if (!doc) return [];
    const parents = projectDocs
      .filter((row) => row.project_code === doc.project_code && row.parent_id == null && row.id !== doc.id)
      .sort((a, b) => a.doc_number.localeCompare(b.doc_number))
      .map((row) => ({ value: String(row.id), label: `${row.doc_number} — ${row.doc_name}` }));
    return [{ value: TOP_LEVEL, label: "— Верхний уровень (самостоятельный документ) —" }, ...parents];
  }, [doc, projectDocs]);

  const targetParentId = target === undefined ? undefined : target === TOP_LEVEL ? null : Number(target);
  const unchanged = doc != null && targetParentId !== undefined && (doc.parent_id ?? null) === targetParentId;
  const currentParent = doc?.parent_id ? projectDocs.find((row) => row.id === doc.parent_id) : null;

  useEffect(() => {
    if (!open || !doc || targetParentId === undefined || unchanged) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    previewMdrMove(doc.id, targetParentId)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(error instanceof Error ? error.message : "Перенос невозможен");
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, doc, targetParentId, unchanged]);

  return (
    <Modal
      open={open}
      title={doc ? `Перенести документ ${doc.doc_number}` : "Перенести документ"}
      okText="Перенести"
      cancelText="Отмена"
      width={680}
      okButtonProps={{ disabled: !preview || unchanged || Boolean(previewError), loading: saving }}
      onCancel={onClose}
      onOk={async () => {
        if (!doc || targetParentId === undefined) return;
        setSaving(true);
        try {
          await moveMdr(doc.id, targetParentId);
          message.success(
            targetParentId === null
              ? `${doc.doc_number} — теперь самостоятельный документ`
              : `${doc.doc_number} перенесён во вложенные к ${preview?.to_parent ?? "документу"}`,
          );
          await onMoved();
          onClose();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "Не удалось перенести документ");
        } finally {
          setSaving(false);
        }
      }}
    >
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Text type="secondary">
          Сейчас: {currentParent ? <>вложен в <b>{currentParent.doc_number}</b></> : <b>верхний уровень</b>}. Шифр при
          переносе не меняется.
        </Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Куда перенести"
          style={{ width: "100%" }}
          value={target}
          options={options}
          onChange={(value) => setTarget(value)}
        />
        {unchanged && <Alert type="info" showIcon message="Документ уже находится здесь" />}
        {loadingPreview && <Spin />}
        {previewError && <Alert type="error" showIcon message="Перенос невозможен" description={previewError} />}
        {preview && !loadingPreview && (
          <>
            {preview.warnings.length > 0 && (
              <Alert
                type={preview.active_revisions.length ? "warning" : "info"}
                showIcon
                message="Что произойдёт"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {preview.warnings.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                }
              />
            )}
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Активная ревизия">
                {preview.active_revisions.length
                  ? preview.active_revisions.map((rev) => (
                      <Tag key={rev.revision_code}>
                        {rev.revision_code} · {getRuStatusLabel(rev.status)}
                      </Tag>
                    ))
                  : "нет"}
              </Descriptions.Item>
              <Descriptions.Item label="Ревьюверы сейчас">
                {preview.reviewers_before.length ? preview.reviewers_before.join("; ") : "никого"}
              </Descriptions.Item>
              <Descriptions.Item label="Ревьюверы после">
                {preview.reviewers_after.length ? preview.reviewers_after.join("; ") : "никого"}
              </Descriptions.Item>
            </Descriptions>
          </>
        )}
      </Space>
    </Modal>
  );
}

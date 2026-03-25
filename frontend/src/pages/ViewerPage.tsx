import { Button, Card, Empty, Select, Space, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";

import { buildDocumentViewUrl, listRevisions } from "../api";
import type { DocumentItem, Revision } from "../types";

interface Props {
  documents: DocumentItem[];
}

export default function ViewerPage({ documents }: Props): JSX.Element {
  const [documentId, setDocumentId] = useState<number | null>(documents[0]?.id ?? null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [selectedRevisionId, setSelectedRevisionId] = useState<number | null>(null);

  const documentOptions = useMemo(
    () =>
      documents.map((doc) => ({
        value: doc.id,
        label: `${doc.document_num} — ${doc.title}`,
      })),
    [documents],
  );

  const revisionOptions = useMemo(
    () =>
      revisions.map((rev) => ({
        value: rev.id,
        label: `${rev.revision_code} (${rev.issue_purpose})`,
      })),
    [revisions],
  );

  const loadRevisions = async (docId: number) => {
    const items = await listRevisions(docId);
    setRevisions(items);
    setSelectedRevisionId(items[0]?.id ?? null);
  };

  useEffect(() => {
    if (!documentId) {
      setRevisions([]);
      setSelectedRevisionId(null);
      return;
    }
    void loadRevisions(documentId);
  }, [documentId]);

  return (
    <Card>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Viewer
        </Typography.Title>

        <Space wrap>
          <Select
            style={{ minWidth: 340 }}
            placeholder="Документ"
            value={documentId ?? undefined}
            options={documentOptions}
            onChange={async (value) => {
              setDocumentId(value);
              await loadRevisions(value);
            }}
          />
          <Select
            style={{ minWidth: 260 }}
            placeholder="Ревизия"
            value={selectedRevisionId ?? undefined}
            options={revisionOptions}
            onChange={(value) => setSelectedRevisionId(value)}
          />
        </Space>

        {selectedRevisionId ? (
          <iframe
            title="document-viewer"
            src={buildDocumentViewUrl(selectedRevisionId)}
            style={{ width: "100%", minHeight: 720, border: "1px solid #e5e7eb", borderRadius: 8 }}
          />
        ) : (
          <Empty description="Выберите ревизию для просмотра" />
        )}

        <Space>
          <Button
            onClick={() => {
              if (!selectedRevisionId) return;
              window.open(buildDocumentViewUrl(selectedRevisionId), "_blank", "noopener,noreferrer");
            }}
            disabled={!selectedRevisionId}
          >
            Открыть в новой вкладке
          </Button>
        </Space>
      </Space>
    </Card>
  );
}

import { Button, Card, Space, Table, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { downloadRevisionAttachmentsArchive, listRevisionsOverview } from "../api";
import ProcessHint from "../components/ProcessHint";
import type { RevisionOverviewItem, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { getDisplayRevisionCode } from "../utils/revisionProcess";
import { ContractorReuploadPdfTag, RevisionStatusCell, contractorNeedsPdfReupload } from "../utils/revisionHints";

interface Props {
  currentUser: User;
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

export default function RevisionsPage({ currentUser, onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<RevisionOverviewItem[]>([]);

  const load = async () => {
    try {
      setItems(await listRevisionsOverview());
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить ревизии";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<RevisionOverviewItem> = [
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Документ", dataIndex: "document_num", key: "document_num" },
    { title: "Название", dataIndex: "document_title", key: "document_title" },
    { title: "Рев", key: "revision_code", width: 70, render: (_, row) => getDisplayRevisionCode(row) },
    {
      title: "Автор ревизии",
      key: "author",
      width: 260,
      render: (_, row) => (row.author_email ? `${row.author_name ?? "—"} (${row.author_email})` : "—"),
    },
    {
      title: "Статус",
      dataIndex: "status",
      key: "status",
      width: 260,
      render: (_, row) => <RevisionStatusCell currentUser={currentUser} status={row.status} />,
    },
    { title: "TRM", dataIndex: "trm_number", key: "trm_number", width: 220, render: (v: string | null) => v ?? "—" },
    { title: "Срок", dataIndex: "review_deadline", key: "review_deadline", width: 130, render: (v: string | null) => formatDateTimeRu(v) },
    {
      title: "Ссылка",
      key: "link",
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Tooltip title="Открыть детальную карточку этой ревизии">
            <Button
              type="link"
              onClick={() => onOpenRevision({ project_code: row.project_code, document_num: row.document_num, revision_id: row.revision_id })}
            >
              Карточка ревизии
            </Button>
          </Tooltip>
          <Tooltip title="Скачать архив доп. файлов этой ревизии">
            <Button
              type="link"
              onClick={async () => {
                try {
                  await downloadRevisionAttachmentsArchive(row.revision_id, row.document_num);
                } catch (error: unknown) {
                  const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                  message.error(text);
                }
              }}
            >
              Файлы
            </Button>
          </Tooltip>
          {contractorNeedsPdfReupload(currentUser, row.status) && <ContractorReuploadPdfTag />}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Ревизии
        </Typography.Title>
        <Button onClick={() => void load()}>Обновить</Button>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать со списком ревизий"
        steps={[
          "Найдите нужную ревизию по документу и статусу.",
          "Откройте карточку ревизии для комментариев и PDF.",
          "Кнопка «Файлы» скачивает дополнительные файлы только выбранной ревизии.",
        ]}
      />
      <Card>
        <Table
          rowKey="revision_id"
          columns={columns}
          dataSource={items}
          pagination={{ pageSize: 12 }}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "Ревизии не найдены. Проверьте доступ и фильтры проекта." }}
        />
      </Card>
    </div>
  );
}

import { Button, Card, Space, Table, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { downloadRevisionAttachmentsArchive, listOwnerReviewQueue, listRevisionsOverview } from "../api";
import ProcessHint from "../components/ProcessHint";
import type { RevisionOverviewItem, TdoQueueItem, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import { getDisplayRevisionCode } from "../utils/revisionProcess";
import { RevisionStatusCell } from "../utils/revisionHints";

interface Props {
  currentUser: User;
  onOpenRevision: (target: { project_code: string; document_num: string; revision_id: number }) => void;
}

interface TrmRow {
  trm_number: string;
  project_code: string;
  revisions_count: number;
  latest_status: string;
  latest_deadline: string | null;
  revisions: RevisionOverviewItem[];
}

interface OwnerTrmRow {
  trm_number: string;
  project_code: string;
  revisions_count: number;
  latest_status: string;
  latest_deadline: string | null;
  revisions: TdoQueueItem[];
}

export default function TrmPage({ currentUser, onOpenRevision }: Props): JSX.Element {
  const [items, setItems] = useState<RevisionOverviewItem[]>([]);
  const [ownerItems, setOwnerItems] = useState<TdoQueueItem[]>([]);

  const load = async () => {
    try {
      if (currentUser.company_type === "owner") {
        setOwnerItems(await listOwnerReviewQueue());
        setItems([]);
      } else {
        setItems(await listRevisionsOverview());
        setOwnerItems([]);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Не удалось загрузить TRM";
      message.error(text);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const grouped = new Map<string, RevisionOverviewItem[]>();
    for (const item of items) {
      if (!item.trm_number) continue;
      const bucket = grouped.get(item.trm_number) ?? [];
      bucket.push(item);
      grouped.set(item.trm_number, bucket);
    }
    const result: TrmRow[] = [];
    for (const [trm, revisions] of grouped.entries()) {
      const sorted = [...revisions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      result.push({
        trm_number: trm,
        project_code: sorted[0].project_code,
        revisions_count: revisions.length,
        latest_status: sorted[0].status,
        latest_deadline: sorted[0].review_deadline,
        revisions: sorted,
      });
    }
    return result.sort((a, b) => (a.trm_number < b.trm_number ? 1 : -1));
  }, [items]);

  const ownerRows = useMemo(() => {
    const grouped = new Map<string, TdoQueueItem[]>();
    for (const item of ownerItems) {
      const key = item.trm_number ?? "Без TRM";
      const bucket = grouped.get(key) ?? [];
      bucket.push(item);
      grouped.set(key, bucket);
    }
    const result: OwnerTrmRow[] = [];
    for (const [trm, revisions] of grouped.entries()) {
      const sorted = [...revisions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      result.push({
        trm_number: trm,
        project_code: sorted[0]?.project_code ?? "—",
        revisions_count: revisions.length,
        latest_status: sorted[0]?.status ?? "—",
        latest_deadline: sorted[0]?.review_deadline ?? null,
        revisions: sorted,
      });
    }
    return result.sort((a, b) => (a.trm_number < b.trm_number ? 1 : -1));
  }, [ownerItems]);

  const columns: ColumnsType<TrmRow> = [
    { title: "TRM", dataIndex: "trm_number", key: "trm_number", width: 260 },
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
    { title: "Кол-во ревизий", dataIndex: "revisions_count", key: "revisions_count", width: 140 },
    {
      title: "Статус",
      dataIndex: "latest_status",
      key: "latest_status",
      width: 260,
      render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
    },
    { title: "Срок", dataIndex: "latest_deadline", key: "latest_deadline", width: 130, render: (v: string | null) => formatDateTimeRu(v) },
  ];

  const ownerColumns: ColumnsType<OwnerTrmRow> = [
    { title: "TRM", dataIndex: "trm_number", key: "trm_number", width: 280 },
    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 100 },
    { title: "Кол-во документов", dataIndex: "revisions_count", key: "revisions_count", width: 170 },
    {
      title: "Последний статус",
      dataIndex: "latest_status",
      key: "latest_status",
      width: 220,
      render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
    },
    { title: "Дедлайн", dataIndex: "latest_deadline", key: "latest_deadline", width: 140, render: (v: string | null) => formatDateTimeRu(v) },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          TRM
        </Typography.Title>
        <Space>
          <Tooltip title="Обновить группы TRM и статусы ревизий">
            <Button onClick={() => void load()}>Обновить</Button>
          </Tooltip>
        </Space>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с TRM"
        steps={[
          "Откройте группу TRM и выберите актуальную ревизию документа.",
          "Комментирование и согласование выполняются только на актуальной ревизии.",
          "Для просмотра деталей переходите в карточку ревизии.",
        ]}
      />
      <Card>
        {currentUser.company_type === "owner" ? (
          <Table
            rowKey="trm_number"
            columns={ownerColumns}
            dataSource={ownerRows}
            pagination={{ pageSize: 10 }}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "TRM пока нет. Появятся после отправки ревизий на проверку." }}
            expandable={{
              expandedRowRender: (row) => (
                <Table
                  rowKey="revision_id"
                  dataSource={row.revisions}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: "В этой группе нет ревизий." }}
                  onRow={(record) => ({
                    onClick: () =>
                      onOpenRevision({
                        project_code: record.project_code,
                        document_num: record.document_num,
                        revision_id: record.revision_id,
                      }),
                    style: { cursor: "pointer" },
                  })}
                  columns={[
                    { title: "№", key: "num", width: 70, render: (_, __, index) => index + 1 },
                    { title: "Проект", dataIndex: "project_code", key: "project_code", width: 90 },
                    { title: "Документ", dataIndex: "document_num", key: "document_num", width: 260 },
                    { title: "Рев", key: "revision_code", width: 80, render: (_, rev) => getDisplayRevisionCode(rev) },
                    { title: "Поступила", dataIndex: "created_at", key: "created_at", width: 170, render: (v: string) => formatDateTimeRu(v) },
                    {
                      title: "Автор ревизии",
                      key: "author",
                      width: 260,
                      render: (_, rev) => (rev.author_email ? `${rev.author_name ?? "—"} (${rev.author_email})` : "—"),
                    },
                    {
                      title: "Статус",
                      dataIndex: "status",
                      key: "status",
                      width: 240,
                      render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
                    },
                    { title: "Дедлайн", dataIndex: "review_deadline", key: "review_deadline", width: 130, render: (v: string | null) => formatDateTimeRu(v) },
                    {
                      title: "Действие",
                      key: "link",
                      render: (_, rev) => (
                        (() => {
                          const latestForDocument = row.revisions
                            .filter((item) => item.document_num === rev.document_num)
                            .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.revision_id - a.revision_id))[0];
                          return latestForDocument?.revision_id === rev.revision_id;
                        })() ? (
                          <Space>
                            <Tooltip title="Открыть карточку актуальной ревизии для согласования">
                              <Button
                                type="link"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onOpenRevision({
                                    project_code: rev.project_code,
                                    document_num: rev.document_num,
                                    revision_id: rev.revision_id,
                                  });
                                }}
                              >
                                Комментировать
                              </Button>
                            </Tooltip>
                            <Tooltip title="Скачать архив доп. файлов актуальной ревизии">
                              <Button
                                type="link"
                                onClick={async (event) => {
                                  event.stopPropagation();
                                  try {
                                    await downloadRevisionAttachmentsArchive(rev.revision_id, rev.document_num);
                                  } catch (error: unknown) {
                                    const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                                    message.error(text);
                                  }
                                }}
                              >
                                Файлы
                              </Button>
                            </Tooltip>
                          </Space>
                        ) : (
                          <Typography.Text type="secondary">Только актуальная</Typography.Text>
                        )
                      ),
                    },
                  ]}
                />
              ),
            }}
          />
        ) : (
          <Table
            rowKey="trm_number"
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 10 }}
            expandable={{
              expandedRowRender: (row) => (
                <Table
                  rowKey="revision_id"
                  dataSource={row.revisions}
                  pagination={false}
                  size="small"
                  locale={{ emptyText: "В этой группе нет ревизий." }}
                  columns={[
                    { title: "Документ", dataIndex: "document_num", key: "document_num" },
                    { title: "Рев", key: "revision_code", width: 80, render: (_, rev) => getDisplayRevisionCode(rev) },
                    {
                      title: "Автор ревизии",
                      key: "author",
                      width: 260,
                      render: (_, rev) => (rev.author_email ? `${rev.author_name ?? "—"} (${rev.author_email})` : "—"),
                    },
                    {
                      title: "Статус",
                      dataIndex: "status",
                      key: "status",
                      width: 260,
                      render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
                    },
                    {
                      title: "Ссылка",
                      key: "link",
                      render: (_, rev) => (
                        <Button
                          type="link"
                          onClick={() =>
                            onOpenRevision({
                              project_code: rev.project_code,
                              document_num: rev.document_num,
                              revision_id: rev.revision_id,
                            })
                          }
                        >
                          Открыть ревизию
                        </Button>
                      ),
                    },
                  ]}
                />
              ),
            }}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: "TRM пока нет. Появятся после отправки ревизий на проверку." }}
          />
        )}
      </Card>
    </div>
  );
}

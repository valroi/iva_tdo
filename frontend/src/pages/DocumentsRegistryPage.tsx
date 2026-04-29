import { Button, Card, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { downloadRevisionAttachmentsArchive, listDocumentsRegistry } from "../api";
import ProcessHint from "../components/ProcessHint";
import type { DocumentRegistryItem, RegistryRevisionItem, User } from "../types";
import { formatDateTimeRu } from "../utils/datetime";
import {
  ContractorReuploadPdfTag,
  RevisionStatusCell,
  contractorNeedsPdfReupload,
} from "../utils/revisionHints";
import { getDisplayRevisionCode, getRemarksSummaryLabel } from "../utils/revisionProcess";

interface Props {
  currentUser: User;
  onOpenRevision: (target: { revision_id: number }) => void;
  presetFilters?: { overdue_only?: boolean } | null;
  onPresetConsumed?: () => void;
}

interface Filters {
  project_code?: string;
  category?: string;
  discipline_code?: string;
  document_title?: string;
  release_status?: string;
  revision_status?: string;
  comments_scope?: "ANY" | "OPEN" | "NONE";
  overdue_only?: boolean;
}

export default function DocumentsRegistryPage({ currentUser, onOpenRevision, presetFilters, onPresetConsumed }: Props): JSX.Element {
  const [rows, setRows] = useState<DocumentRegistryItem[]>([]);
  const [filters, setFilters] = useState<Filters>({ comments_scope: "ANY" });
  const [loading, setLoading] = useState(false);

  const loadData = async (nextFilters: Filters) => {
    setLoading(true);
    try {
      setRows(await listDocumentsRegistry(nextFilters));
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось загрузить документы");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(filters);
  }, []);

  useEffect(() => {
    if (!presetFilters) return;
    const next: Filters = { ...filters, ...presetFilters };
    setFilters(next);
    void loadData(next);
    onPresetConsumed?.();
  }, [presetFilters]);

  const projectOptions = useMemo(
    () => Array.from(new Set(rows.map((item) => item.project_code))).map((value) => ({ value, label: value })),
    [rows],
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(rows.map((item) => item.category))).map((value) => ({ value, label: value })),
    [rows],
  );
  const disciplineOptions = useMemo(
    () => Array.from(new Set(rows.map((item) => item.discipline_code))).map((value) => ({ value, label: value })),
    [rows],
  );

  const columns: ColumnsType<DocumentRegistryItem> = [
    { title: "Проект", dataIndex: "project_code", width: 90 },
    { title: "Категория", dataIndex: "category", width: 110 },
    { title: "Дисциплина", dataIndex: "discipline_code", width: 100 },
    {
      title: "Документ",
      dataIndex: "document_num",
      width: 250,
      ellipsis: true,
      render: (value: string, row) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() => {
            const latestRevisionId = row.revisions[0]?.id;
            if (!latestRevisionId) {
              message.info("Для документа пока нет ревизий");
              return;
            }
            onOpenRevision({ revision_id: latestRevisionId });
          }}
        >
          {value}
        </Button>
      ),
    },
    { title: "Название", dataIndex: "document_title", width: 190, ellipsis: true },
    { title: "Последняя ревизия", dataIndex: "latest_revision_code", width: 120, render: (v) => v ?? "—" },
    {
      title: "Последний статус",
      dataIndex: "latest_revision_status",
      width: 200,
      render: (v) =>
        v ? (
          <Space direction="vertical" size={2}>
            <Typography.Text>{v}</Typography.Text>
            {contractorNeedsPdfReupload(currentUser, v) && <ContractorReuploadPdfTag />}
          </Space>
        ) : (
          "—"
        ),
    },
    { title: "Статус выпуска", dataIndex: "latest_review_code", width: 120, render: (v) => v ?? "—" },
    { title: "Автор", dataIndex: "latest_author_name", width: 170, render: (v) => v ?? "—" },
    { title: "Дата разработки", dataIndex: "development_date", width: 140, render: (v) => formatDateTimeRu(v) },
    { title: "Первая загрузка", dataIndex: "first_upload_date", width: 140, render: (v) => formatDateTimeRu(v) },
    {
      title: "Просрочка",
      dataIndex: "is_overdue",
      width: 110,
      render: (v: boolean | undefined) => (v ? <Tag color="error">Да</Tag> : "—"),
    },
    {
      title: "Замечания",
      key: "comments",
      width: 120,
      render: (_, row) => (
        <Tag color={row.open_comments_count > 0 ? "gold" : "green"}>
          {row.open_comments_count}/{row.total_comments_count}
        </Tag>
      ),
    },
  ];

  const revisionColumns: ColumnsType<RegistryRevisionItem> = [
    {
      title: "Рев",
      width: 80,
      ellipsis: true,
      render: (_, row) => getDisplayRevisionCode(row),
    },
    { title: "Цель", dataIndex: "issue_purpose", width: 100, ellipsis: true },
    {
      title: "Статус",
      dataIndex: "status",
      width: 220,
      render: (v: string) => <RevisionStatusCell currentUser={currentUser} status={v} />,
    },
    {
      title: "Статус по замечаниям",
      width: 190,
      render: (_, row) => {
        if (row.review_code) return row.review_code;
        const calculated = getRemarksSummaryLabel(row.comments as never, row.review_code);
        return calculated === "Нет замечаний" ? "—" : calculated;
      },
    },
    {
      title: "TRM",
      width: 120,
      render: (_, row) => (row.trm_flag ? <Tag color="blue">{row.trm_number ?? "Да"}</Tag> : "—"),
    },
    { title: "Автор", dataIndex: "author_name", width: 160, render: (v) => v ?? "—", ellipsis: true },
    {
      title: "Замечания",
      width: 130,
      render: (_, row) => {
        const resolved = row.comments.filter((item) => item.status === "RESOLVED").length;
        return `${resolved}/${row.comments_count}`;
      },
    },
    {
      title: "Действие",
      width: 160,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Button size="small" onClick={() => onOpenRevision({ revision_id: row.id })}>
            Открыть
          </Button>
          <Button
            size="small"
            onClick={async () => {
              try {
                await downloadRevisionAttachmentsArchive(row.id, row.document_num);
              } catch (error: unknown) {
                const text = error instanceof Error ? error.message : "Нет дополнительных файлов";
                message.error(text);
              }
            }}
          >
            Файлы
          </Button>
          {contractorNeedsPdfReupload(currentUser, row.status) && <ContractorReuploadPdfTag />}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Документы и ревизии
        </Typography.Title>
      </Space>
      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как пользоваться реестром"
        steps={[
          "Выберите фильтры и нажмите «Применить».",
          "Раскройте документ, чтобы увидеть историю ревизий.",
          "Откройте карточку ревизии для детальной работы и ответов.",
        ]}
      />
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="Проект"
            style={{ width: 150 }}
            options={projectOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, project_code: value ?? undefined }))}
          />
          <Select
            allowClear
            placeholder="Категория"
            style={{ width: 150 }}
            options={categoryOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, category: value ?? undefined }))}
          />
          <Select
            allowClear
            placeholder="Дисциплина"
            style={{ width: 150 }}
            options={disciplineOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, discipline_code: value ?? undefined }))}
          />
          <Input
            allowClear
            placeholder="Название документа"
            style={{ width: 220 }}
            value={filters.document_title}
            onChange={(event) =>
              setFilters((prev) => ({
                ...prev,
                document_title: event.target.value.trim() ? event.target.value : undefined,
              }))
            }
          />
          <Select
            allowClear
            placeholder="Статус выпуска"
            style={{ width: 160 }}
            options={["AP", "AN", "CO", "RJ"].map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, release_status: value ?? undefined }))}
          />
          <Select
            allowClear
            placeholder="Шаг воркфлоу"
            style={{ width: 180 }}
            options={["REVISION_CREATED", "UPLOADED_WAITING_TDO", "UNDER_REVIEW", "CANCELLED_BY_TDO", "SUBMITTED"].map((value) => ({ value, label: value }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, revision_status: value ?? undefined }))}
          />
          <Select
            placeholder="По замечаниям"
            style={{ width: 170 }}
            value={filters.comments_scope}
            options={[
              { value: "ANY", label: "Все" },
              { value: "OPEN", label: "Есть открытые" },
              { value: "NONE", label: "Без замечаний" },
            ]}
            onChange={(value) => setFilters((prev) => ({ ...prev, comments_scope: value }))}
          />
          <Select
            placeholder="Просрочка"
            style={{ width: 160 }}
            value={filters.overdue_only ? "ONLY" : "ANY"}
            options={[
              { value: "ANY", label: "Все" },
              { value: "ONLY", label: "Только просроченные" },
            ]}
            onChange={(value) => setFilters((prev) => ({ ...prev, overdue_only: value === "ONLY" }))}
          />
          <Tooltip title="Обновить реестр с выбранными фильтрами">
            <Button type="primary" onClick={() => void loadData(filters)}>
              Применить фильтр
            </Button>
          </Tooltip>
        </Space>
      </Card>

      <div style={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}>
      <Table
        rowKey="document_id"
        loading={loading}
        columns={columns}
        dataSource={rows}
        size="small"
        expandable={{
          expandedRowRender: (row) => (
            <div style={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}>
              <Table
                rowKey="id"
                columns={revisionColumns}
                dataSource={row.revisions}
                size="small"
                pagination={false}
                tableLayout="fixed"
                scroll={{ x: 900 }}
                locale={{ emptyText: "По документу еще нет ревизий." }}
              />
            </div>
          ),
        }}
        pagination={{ pageSize: 20 }}
        tableLayout="fixed"
        scroll={{ x: 1500 }}
        locale={{ emptyText: "Реестр пуст. Уточните фильтры или проверьте выбранный проект." }}
      />
      </div>
    </div>
  );
}


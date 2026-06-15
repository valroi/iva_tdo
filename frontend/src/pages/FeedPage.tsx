import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { DownloadOutlined, RobotOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import {
  askFeed,
  deleteFeedDocument,
  deleteFeedFile,
  downloadFeedFile,
  listFeedDocuments,
  listProjects,
  searchFeed,
  updateFeedDocument,
  uploadFeedDocuments,
  uploadFeedFile,
} from "../api";
import ProcessHint from "../components/ProcessHint";
import type { FeedAskResult, FeedDocumentItem, FeedSearchHit, ProjectItem, User } from "../types";

interface Props {
  currentUser: User;
}

const LANG_LABEL: Record<string, string> = { RU: "RU", EN: "EN", BI: "RU/EN", NA: "—" };
const LANG_COLOR: Record<string, string> = { RU: "blue", EN: "geekblue", BI: "purple", NA: "default" };

/**
 * Модуль FEED — документация стадии FEED.
 * Структура: проект → дисциплина → документы (шифр, RU/EN название,
 * класс 1/1А, финальная ревизия; для 1А — ACRS). Массовая загрузка с
 * автораспознаванием шифра (штамп → имя файла). Поиск + AI-чат.
 */
export default function FeedPage({ currentUser: _currentUser }: Props): JSX.Element {
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [docs, setDocs] = useState<FeedDocumentItem[]>([]);
  const [disciplineFilter, setDisciplineFilter] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editDoc, setEditDoc] = useState<FeedDocumentItem | null>(null);
  const [editForm] = Form.useForm();
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<FeedSearchHit[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLog, setChatLog] = useState<{ q: string; a: FeedAskResult }[]>([]);

  const loadDocs = async (pid: number | null) => {
    if (pid === null) {
      setDocs([]);
      return;
    }
    try {
      setDocs(await listFeedDocuments(pid));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось загрузить документы");
    }
  };

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) setProjectId(ps[0].id);
      })
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    void loadDocs(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const disciplines = useMemo(
    () => Array.from(new Set(docs.map((d) => d.discipline_code))).sort(),
    [docs],
  );
  const visibleDocs = useMemo(
    () => (disciplineFilter ? docs.filter((d) => d.discipline_code === disciplineFilter) : docs),
    [docs, disciplineFilter],
  );
  const docsByDiscipline = useMemo(() => {
    const groups: Record<string, FeedDocumentItem[]> = {};
    for (const d of visibleDocs) (groups[d.discipline_code] ??= []).push(d);
    return groups;
  }, [visibleDocs]);

  const handleBulkUpload = async () => {
    if (projectId === null || uploadFiles.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadFeedDocuments(projectId, uploadFiles);
      message.success(`Создано: ${res.created}, обновлено: ${res.updated}, ошибок: ${res.failed}`);
      const unresolved = res.items.filter((i) => i.doc_number?.startsWith("UNRESOLVED"));
      if (unresolved.length) {
        message.warning(`Не распознан шифр у ${unresolved.length} файлов — поправьте вручную (строки UNRESOLVED).`);
      }
      setUploadFiles([]);
      await loadDocs(projectId);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setUploading(false);
    }
  };

  const runSearch = async () => {
    if (!searchQ.trim() || projectId === null) {
      setSearchHits(null);
      return;
    }
    try {
      setSearchHits(await searchFeed(searchQ.trim(), projectId));
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Ошибка поиска");
    }
  };

  const askAi = async () => {
    if (!chatQuestion.trim() || projectId === null) return;
    setChatBusy(true);
    const q = chatQuestion.trim();
    try {
      const a = await askFeed(q, projectId);
      setChatLog((prev) => [...prev, { q, a }]);
      setChatQuestion("");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Ошибка запроса");
    } finally {
      setChatBusy(false);
    }
  };

  const columns: ColumnsType<FeedDocumentItem> = [
    {
      title: "Шифр",
      dataIndex: "doc_number",
      key: "doc_number",
      width: 230,
      render: (v: string) =>
        v.startsWith("UNRESOLVED") ? <Tag color="error">{v.slice(0, 28)}…</Tag> : <Typography.Text copyable={{ text: v }}>{v}</Typography.Text>,
    },
    { title: "Название (EN)", dataIndex: "title_en", key: "ten", ellipsis: true, render: (v) => v ?? "—" },
    { title: "Название (RU)", dataIndex: "title_ru", key: "tru", ellipsis: true, render: (v) => v ?? "—" },
    {
      title: "Класс",
      dataIndex: "doc_class",
      key: "cls",
      width: 90,
      render: (v: string, row) => (
        <Select
          size="small"
          value={v}
          style={{ width: 70 }}
          options={[{ value: "1", label: "1" }, { value: "1A", label: "1А" }]}
          onChange={async (val) => {
            await updateFeedDocument(row.id, { doc_class: val });
            await loadDocs(projectId);
          }}
        />
      ),
    },
    { title: "Рев", dataIndex: "latest_rev", key: "rev", width: 60, render: (v) => v ?? "—" },
    {
      title: "Файлы (версии)",
      key: "files",
      width: 260,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          {row.files.filter((f) => f.kind === "REVISION").map((f) => (
            <Space key={f.id} size={4}>
              <Tag color={LANG_COLOR[f.lang]} style={{ marginRight: 0 }}>{LANG_LABEL[f.lang]}</Tag>
              <Button size="small" type="link" icon={<DownloadOutlined />} style={{ padding: 0 }}
                onClick={() => void downloadFeedFile(f.id, f.file_name)}>
                {f.rev ? `rev ${f.rev}` : f.file_name.slice(0, 16)}
              </Button>
              <Button size="small" type="link" danger style={{ padding: 0 }} onClick={async () => { await deleteFeedFile(f.id); await loadDocs(projectId); }}>✕</Button>
            </Space>
          ))}
          {/* Дозагрузка ещё одной языковой версии под тот же шифр */}
          <Upload showUploadList={false} beforeUpload={(file) => {
            void uploadFeedFile(row.id, file, "REVISION").then(() => loadDocs(projectId)).catch((e) => message.error(e.message));
            return false;
          }}>
            <Button size="small" type="dashed" icon={<UploadOutlined />}>+ версия</Button>
          </Upload>
        </Space>
      ),
    },
    {
      title: "ACRS",
      key: "acrs",
      width: 160,
      render: (_, row) => {
        if (row.doc_class !== "1A") return <Typography.Text type="secondary">—</Typography.Text>;
        const acrs = row.files.filter((f) => f.kind === "ACRS");
        return (
          <Space direction="vertical" size={2}>
            {acrs.map((f) => (
              <Space key={f.id} size={4}>
                <Button size="small" type="link" icon={<DownloadOutlined />} style={{ padding: 0 }}
                  onClick={() => void downloadFeedFile(f.id, f.file_name)}>ACRS</Button>
                <Button size="small" type="link" danger style={{ padding: 0 }} onClick={async () => { await deleteFeedFile(f.id); await loadDocs(projectId); }}>✕</Button>
              </Space>
            ))}
            <Upload showUploadList={false} beforeUpload={(file) => {
              void uploadFeedFile(row.id, file, "ACRS").then(() => loadDocs(projectId)).catch((e) => message.error(e.message));
              return false;
            }}>
              <Button size="small" icon={<UploadOutlined />}>ACRS</Button>
            </Upload>
          </Space>
        );
      },
    },
    {
      title: "",
      key: "actions",
      width: 130,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" onClick={() => {
            setEditDoc(row);
            editForm.setFieldsValue({
              doc_number: row.doc_number,
              title_en: row.title_en ?? "",
              title_ru: row.title_ru ?? "",
              discipline_code: row.discipline_code,
              latest_rev: row.latest_rev ?? "",
            });
          }}>Изм.</Button>
          <Button size="small" danger onClick={() => modal.confirm({
            title: "Удалить документ?",
            content: `${row.doc_number} и все его файлы будут удалены.`,
            okText: "Удалить", okButtonProps: { danger: true }, cancelText: "Отмена",
            onOk: async () => { await deleteFeedDocument(row.id); await loadDocs(projectId); },
          })}>✕</Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 12 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>FEED — документация проекта</Typography.Title>
        <Space wrap>
          <Select
            style={{ width: 240 }}
            value={projectId ?? undefined}
            placeholder="Проект"
            options={projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))}
            onChange={(v) => { setProjectId(v); setDisciplineFilter(null); setSearchHits(null); }}
          />
          <Select
            style={{ width: 150 }}
            allowClear
            value={disciplineFilter ?? undefined}
            placeholder="Дисциплина"
            options={disciplines.map((d) => ({ value: d, label: d }))}
            onChange={(v) => setDisciplineFilter(v ?? null)}
          />
          <Button icon={<RobotOutlined />} onClick={() => setChatOpen(true)}>AI-поиск</Button>
        </Space>
      </Space>

      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с модулем FEED"
        steps={[
          "Выберите проект и загрузите документы пачкой — шифр, дисциплина и ревизия распознаются автоматически (штамп → имя файла).",
          "Нераспознанные строки помечаются UNRESOLVED — поправьте шифр кнопкой «Изм.».",
          "Для документов класса 1А прикрепите ACRS. Поиск и AI-чат — по всему тексту документации.",
        ]}
      />

      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
          <Space wrap>
            <Upload
              multiple
              showUploadList={false}
              beforeUpload={(_file, fileList) => {
                // antd вызывает beforeUpload для каждого файла; добавляем один раз.
                setUploadFiles((prev) => {
                  const names = new Set(prev.map((f) => f.name));
                  const fresh = fileList.filter((f) => !names.has(f.name));
                  return [...prev, ...(fresh as unknown as File[])];
                });
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>Выбрать файлы (PDF/DOCX)</Button>
            </Upload>
            {uploadFiles.length > 0 && (
              <>
                <Typography.Text type="secondary">{uploadFiles.length} файл(ов)</Typography.Text>
                <Button type="primary" loading={uploading} onClick={handleBulkUpload}>Загрузить</Button>
                <Button onClick={() => setUploadFiles([])}>Сброс</Button>
              </>
            )}
          </Space>
          <Space.Compact style={{ width: 360 }}>
            <Input
              placeholder="Поиск по документации…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onPressEnter={runSearch}
              allowClear
            />
            <Button icon={<SearchOutlined />} onClick={runSearch} />
          </Space.Compact>
        </Space>
        {searchHits !== null && (
          <Card size="small" style={{ marginTop: 12 }} title={`Результаты поиска (${searchHits.length})`}
            extra={<Button size="small" onClick={() => setSearchHits(null)}>Закрыть</Button>}>
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              {searchHits.length === 0 && <Typography.Text type="secondary">Ничего не найдено.</Typography.Text>}
              {searchHits.map((h) => {
                const doc = docs.find((d) => d.id === h.document_id);
                const primary = doc?.files.find((f) => f.kind === "REVISION") ?? doc?.files[0];
                return (
                  <div key={h.document_id}>
                    <Space size={6}>
                      <Button type="link" size="small" icon={<DownloadOutlined />} style={{ padding: 0 }}
                        disabled={!primary} onClick={() => primary && void downloadFeedFile(primary.id, primary.file_name)}>
                        <b>{h.doc_number}</b>
                      </Button>
                      <Typography.Text>{h.title_en || h.title_ru || ""}</Typography.Text>
                      <Tag>{h.discipline_code}</Tag>
                    </Space>
                    {h.snippet && <Typography.Paragraph type="secondary" style={{ margin: "2px 0 0" }}>{h.snippet}</Typography.Paragraph>}
                  </div>
                );
              })}
            </Space>
          </Card>
        )}
      </Card>

      {Object.keys(docsByDiscipline).length === 0 && (
        <Card><Typography.Text type="secondary">Документов пока нет. Загрузите файлы выше.</Typography.Text></Card>
      )}
      {Object.entries(docsByDiscipline).map(([disc, list]) => (
        <Card key={disc} size="small" style={{ marginBottom: 12 }}
          title={<Space><Tag color="blue">{disc}</Tag><Typography.Text strong>Дисциплина {disc}</Typography.Text><Typography.Text type="secondary">({list.length})</Typography.Text></Space>}>
          <Table rowKey="id" size="small" columns={columns} dataSource={list} pagination={list.length > 20 ? { pageSize: 20 } : false} />
        </Card>
      ))}

      {/* Редактирование документа */}
      <Modal open={editDoc !== null} title={`Документ: ${editDoc?.doc_number ?? ""}`} okText="Сохранить" cancelText="Отмена"
        onCancel={() => setEditDoc(null)} onOk={() => editForm.submit()}>
        <Form form={editForm} layout="vertical" onFinish={async (values) => {
          if (!editDoc) return;
          try {
            await updateFeedDocument(editDoc.id, {
              doc_number: values.doc_number,
              title_en: values.title_en || null,
              title_ru: values.title_ru || null,
              discipline_code: values.discipline_code,
              latest_rev: values.latest_rev || null,
            });
            setEditDoc(null);
            await loadDocs(projectId);
            message.success("Сохранено");
          } catch (e) { message.error(e instanceof Error ? e.message : "Ошибка"); }
        }}>
          <Form.Item name="doc_number" label="Шифр (без ревизии)" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="title_en" label="Название (EN)"><Input /></Form.Item>
          <Form.Item name="title_ru" label="Название (RU)"><Input /></Form.Item>
          <Space size={12}>
            <Form.Item name="discipline_code" label="Дисциплина"><Input style={{ width: 110 }} /></Form.Item>
            <Form.Item name="latest_rev" label="Ревизия"><Input style={{ width: 90 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* AI-чат по документации */}
      <Drawer open={chatOpen} onClose={() => setChatOpen(false)} title="AI-поиск по документации FEED" width={560}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {chatLog.length === 0 && (
            <Typography.Text type="secondary">
              Задайте вопрос по документации — ответ с указанием документов-источников.
              Без настроенного AI-ключа работает обычный поиск по ключевым словам.
            </Typography.Text>
          )}
          {chatLog.map((entry, i) => (
            <div key={i}>
              <Typography.Paragraph strong style={{ marginBottom: 4 }}>Вы: {entry.q}</Typography.Paragraph>
              <Card size="small">
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: entry.a.sources.length ? 8 : 0 }}>
                  {entry.a.answer}
                </Typography.Paragraph>
                {entry.a.sources.length > 0 && (
                  <Space direction="vertical" size={2}>
                    <Typography.Text type="secondary">Источники (нажмите для скачивания):</Typography.Text>
                    {entry.a.sources.map((s) => {
                      const doc = docs.find((d) => d.id === s.document_id);
                      const primary = doc?.files.find((f) => f.kind === "REVISION") ?? doc?.files[0];
                      return (
                        <Button
                          key={s.document_id}
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          style={{ padding: 0, height: "auto", textAlign: "left", whiteSpace: "normal" }}
                          disabled={!primary}
                          onClick={() => primary && void downloadFeedFile(primary.id, primary.file_name)}
                        >
                          {s.doc_number} — {s.title_en || s.title_ru || ""}
                        </Button>
                      );
                    })}
                  </Space>
                )}
              </Card>
            </div>
          ))}
          <Space.Compact style={{ width: "100%" }}>
            <Input
              placeholder="Ваш вопрос по документации…"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              onPressEnter={askAi}
              disabled={chatBusy}
            />
            <Button type="primary" loading={chatBusy} onClick={askAi}>Спросить</Button>
          </Space.Compact>
        </Space>
      </Drawer>
    </div>
  );
}

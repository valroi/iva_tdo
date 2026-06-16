import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Modal,
  Progress,
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

import { Switch } from "antd";

import {
  askFeed,
  deleteFeedDocument,
  deleteFeedFile,
  downloadFeedFile,
  getFeedSettings,
  listFeedDocuments,
  listProjects,
  searchFeed,
  setFeedSettings,
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
export default function FeedPage({ currentUser }: Props): JSX.Element {
  const { message, modal } = App.useApp();
  const isAdmin = currentUser.permissions.can_manage_users;
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [docs, setDocs] = useState<FeedDocumentItem[]>([]);
  const [disciplineFilter, setDisciplineFilter] = useState<string | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
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
    getFeedSettings()
      .then((s) => { setAiEnabled(s.ai_enabled); setAiConfigured(s.ai_configured); })
      .catch(() => undefined);
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
    // Грузим по одному файлу, чтобы показывать живой прогресс (PDF парсятся
    // по несколько секунд, иначе кажется что «висит»).
    let created = 0, updated = 0, failed = 0, duplicate = 0, unresolved = 0;
    const total = uploadFiles.length;
    try {
      for (let i = 0; i < uploadFiles.length; i++) {
        const file = uploadFiles[i];
        setProgress({ done: i, total, current: file.name });
        try {
          const res = await uploadFeedDocuments(projectId, [file]);
          created += res.created; updated += res.updated; failed += res.failed; duplicate += res.duplicate;
          if (res.items.some((it) => it.doc_number?.startsWith("UNRESOLVED"))) unresolved += 1;
        } catch {
          failed += 1;
        }
        setProgress({ done: i + 1, total, current: file.name });
      }
      const parts = [`создано: ${created}`, `обновлено: ${updated}`];
      if (duplicate) parts.push(`дублей пропущено: ${duplicate}`);
      if (failed) parts.push(`ошибок: ${failed}`);
      message.success(parts.join(", "));
      if (unresolved) message.warning(`Не распознан шифр у ${unresolved} файлов — поправьте вручную (строки UNRESOLVED).`);
      setUploadFiles([]);
      await loadDocs(projectId);
    } finally {
      setUploading(false);
      setProgress(null);
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
      width: 250,
      render: (v: string, row) =>
        v.startsWith("UNRESOLVED") ? (
          <Tag color="error">{v.slice(0, 28)}…</Tag>
        ) : (
          <Space size={4} wrap>
            <Typography.Text copyable={{ text: v }} style={{ fontSize: 12 }}>{v}</Typography.Text>
            {row.incomplete && (
              <Tag color="error" style={{ marginRight: 0 }} title={row.incomplete_reason ?? "Не хватает версии документа"}>
                ⚠ {row.incomplete_reason ?? "нет файла"}
              </Tag>
            )}
          </Space>
        ),
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
              <Tag color={f.is_editable ? "default" : LANG_COLOR[f.lang]} style={{ marginRight: 0 }}>{LANG_LABEL[f.lang]}</Tag>
              {f.is_editable && (
                <Tag color="gold" style={{ marginRight: 0 }} title="Не-PDF (редактируемый исходник) — не считается главной версией">ред.</Tag>
              )}
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
          {isAdmin && aiConfigured && (
            <Space size={4}>
              <RobotOutlined style={{ color: aiEnabled ? "#1677ff" : "#bbb" }} />
              <Typography.Text type="secondary">Умный поиск</Typography.Text>
              <Switch
                size="small"
                checked={aiEnabled}
                onChange={async (v) => {
                  try {
                    const res = await setFeedSettings(v);
                    setAiEnabled(res.ai_enabled);
                    message.success(v ? "Умный поиск включён" : "Умный поиск выключен");
                  } catch (e) { message.error(e instanceof Error ? e.message : "Ошибка"); }
                }}
              />
            </Space>
          )}
          <Button icon={<SearchOutlined />} onClick={() => setChatOpen(true)}>Поиск</Button>
        </Space>
      </Space>

      <ProcessHint
        style={{ marginBottom: 12 }}
        title="Как работать с модулем FEED"
        steps={[
          "Выберите проект и загрузите документы пачкой — шифр, дисциплина и ревизия распознаются автоматически (штамп → имя файла).",
          "Нераспознанные строки помечаются UNRESOLVED — поправьте шифр кнопкой «Изм.».",
          "Класс 1 = главными считаются PDF (RU и EN либо двуязычный); только одна версия — красный тег «не хватает». Класс 1А — английский PDF + ACRS.",
          "Дубли по содержимому не загружаются (даже под другим именем). Не-PDF (docx/xls) помечаются «ред.» — это редактируемые исходники, не главные.",
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
      {(() => {
        const totalIncomplete = visibleDocs.filter((d) => d.incomplete).length;
        return totalIncomplete > 0 ? (
          <Card size="small" style={{ marginBottom: 12, borderColor: "#ffccc7", background: "#fff2f0" }}>
            <Space wrap>
              <Tag color="error">⚠ Не хватает файлов: {totalIncomplete}</Tag>
              {disciplines.map((disc) => {
                const n = visibleDocs.filter((d) => d.discipline_code === disc && d.incomplete).length;
                return n > 0 ? <Tag key={disc} color="error" style={{ marginRight: 0 }}>{disc}: {n}</Tag> : null;
              })}
              <Typography.Text type="secondary">— класс 1 без второй языковой версии или без PDF; догрузите недостающее.</Typography.Text>
            </Space>
          </Card>
        ) : null;
      })()}
      {Object.entries(docsByDiscipline).map(([disc, list]) => {
        const incompleteN = list.filter((d) => d.incomplete).length;
        return (
          <Card key={disc} size="small" style={{ marginBottom: 12 }}
            title={
              <Space>
                <Tag color="blue">{disc}</Tag>
                <Typography.Text strong>Дисциплина {disc}</Typography.Text>
                <Typography.Text type="secondary">({list.length})</Typography.Text>
                {incompleteN > 0 && <Tag color="error" style={{ marginRight: 0 }}>⚠ {incompleteN} без комплекта</Tag>}
              </Space>
            }>
            <Table rowKey="id" size="small" columns={columns} dataSource={list} pagination={list.length > 20 ? { pageSize: 20 } : false} />
          </Card>
        );
      })}

      {/* Прогресс загрузки */}
      <Modal open={progress !== null} title="Загрузка документов в FEED" footer={null} closable={false} maskClosable={false}>
        {progress && (
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Progress percent={Math.round((progress.done / progress.total) * 100)} status="active" />
            <Typography.Text>
              Файл {Math.min(progress.done + 1, progress.total)} из {progress.total}
            </Typography.Text>
            <Typography.Text type="secondary" ellipsis>
              Обрабатывается: {progress.current} — распознаём шифр, дисциплину, текст для поиска…
            </Typography.Text>
          </Space>
        )}
      </Modal>

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

      {/* Поиск по документации (умный, если включён админом) */}
      <Drawer open={chatOpen} onClose={() => setChatOpen(false)} title="Поиск по документации FEED" width={560}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {chatLog.length === 0 && (
            <Typography.Text type="secondary">
              {aiEnabled && aiConfigured
                ? "Умный поиск включён: задайте вопрос — нейросеть ответит по содержанию документов и укажет источники."
                : "Поиск по ключевым словам: введите термин из документа — покажу подходящие документы со ссылками."}
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

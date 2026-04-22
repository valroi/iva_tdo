import { InboxOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Input, Row, Space, Typography, Upload, message } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useMemo, useState } from "react";

import { smartUploadPreview, smartUploadProcess, type SmartUploadPreviewResult, type SmartUploadProcessResult } from "../api";

type FieldMap = Record<string, string>;

const FIELD_ORDER = [
  "full_cipher",
  "project",
  "phase",
  "unit",
  "title_code",
  "discipline",
  "doc_type",
  "serial",
  "revision",
  "title_text",
];

export default function DocCheckerPage(): JSX.Element {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [relatedFiles, setRelatedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<SmartUploadPreviewResult | null>(null);
  const [processingResult, setProcessingResult] = useState<SmartUploadProcessResult | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingProcess, setLoadingProcess] = useState(false);
  const [form] = Form.useForm<FieldMap>();

  const previewFields = useMemo(() => {
    if (!preview) return null;
    const next: FieldMap = {};
    for (const key of FIELD_ORDER) {
      const value = preview.fields[key];
      if (value !== null && value !== undefined) {
        next[key] = String(value);
      }
    }
    return next;
  }, [preview]);

  const handlePreview = async () => {
    if (!pdfFile) {
      message.warning("Сначала выбери PDF файл");
      return;
    }
    setLoadingPreview(true);
    try {
      const result = await smartUploadPreview(pdfFile);
      setPreview(result);
      setProcessingResult(null);
      const values: FieldMap = {};
      for (const key of FIELD_ORDER) {
        const value = result.fields[key];
        if (value !== null && value !== undefined) {
          values[key] = String(value);
        }
      }
      form.setFieldsValue(values);
      message.success("Поля извлечены, проверь и подтверди");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось выполнить предпросмотр");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleProcess = async () => {
    if (!pdfFile) {
      message.warning("Сначала выбери PDF файл");
      return;
    }
    setLoadingProcess(true);
    try {
      const overrides = form.getFieldsValue();
      const result = await smartUploadProcess({
        pdf: pdfFile,
        relatedFiles,
        overrides,
      });
      setProcessingResult(result);
      message.success("DOCchecker завершил раскладку файлов");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось обработать файлы");
    } finally {
      setLoadingProcess(false);
    }
  };

  const pdfList: UploadFile[] = pdfFile
    ? [{ uid: "pdf-1", name: pdfFile.name, status: "done", originFileObj: pdfFile }]
    : [];
  const relatedList: UploadFile[] = relatedFiles.map((file, index) => ({
    uid: `related-${index}`,
    name: file.name,
    status: "done",
    originFileObj: file,
  }));

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title="DOCchecker - умная загрузка документов" className="hrp-card">
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Upload.Dragger
            accept=".pdf"
            maxCount={1}
            fileList={pdfList}
            beforeUpload={(file) => {
              setPdfFile(file);
              return false;
            }}
            onRemove={() => {
              setPdfFile(null);
              setPreview(null);
              setProcessingResult(null);
              form.resetFields();
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Перетащи PDF сюда или нажми для выбора</p>
            <p className="ant-upload-hint">Из этого файла DOCchecker извлечет шифр и поля документа</p>
          </Upload.Dragger>

          <Upload
            multiple
            fileList={relatedList}
            beforeUpload={(file) => {
              setRelatedFiles((prev) => [...prev, file]);
              return false;
            }}
            onRemove={(file) => {
              setRelatedFiles((prev) => prev.filter((item) => item.name !== file.name));
            }}
          >
            <Button>Добавить связанные файлы (DOCX/XLSX/DWG/...)</Button>
          </Upload>

          <Space>
            <Button type="default" loading={loadingPreview} onClick={handlePreview}>
              Предпросмотр шифра
            </Button>
            <Button type="primary" loading={loadingProcess} onClick={handleProcess}>
              Подтвердить и разложить
            </Button>
          </Space>
        </Space>
      </Card>

      {preview && (
        <Card title="Распознанные поля" className="hrp-card">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type={preview.requires_confirmation ? "warning" : "success"}
              message={
                preview.requires_confirmation
                  ? "Нужна проверка: отредактируй поля перед сохранением"
                  : "Поля распознаны уверенно"
              }
              description={`Источник: ${preview.source}. Confidence: ${preview.confidence.toFixed(2)}. Иерархия: ${preview.suggested_hierarchy}`}
            />
            <Form layout="vertical" form={form}>
              <Row gutter={[12, 0]}>
                {FIELD_ORDER.map((key) => (
                  <Col span={8} key={key}>
                    <Form.Item name={key} label={key}>
                      <Input />
                    </Form.Item>
                  </Col>
                ))}
              </Row>
            </Form>
          </Space>
        </Card>
      )}

      {processingResult && (
        <Card title="Результат обработки" className="hrp-card">
          <Space direction="vertical" size={8}>
            <Typography.Text>
              <strong>Иерархия:</strong> {processingResult.hierarchy}
            </Typography.Text>
            <Typography.Text>
              <strong>Путь:</strong> {processingResult.destination}
            </Typography.Text>
            <Typography.Text>
              <strong>PDF:</strong> {processingResult.pdf_path}
            </Typography.Text>
            <Typography.Text>
              <strong>Связанные файлы:</strong> {processingResult.related_paths.length || 0}
            </Typography.Text>
          </Space>
        </Card>
      )}
    </Space>
  );
}

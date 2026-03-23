import { Card, Col, Row, Statistic, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { DocumentItem, MDRRecord, NotificationItem, WorkflowStatus } from "../types";

interface Props {
  mdr: MDRRecord[];
  documents: DocumentItem[];
  notifications: NotificationItem[];
  workflowStatuses: WorkflowStatus[];
}

interface StatusRow {
  key: string;
  code: string;
  name: string;
}

export default function DashboardPage({
  mdr,
  documents,
  notifications,
  workflowStatuses,
}: Props): JSX.Element {
  const unread = notifications.filter((n) => !n.is_read).length;

  const statusRows: StatusRow[] = workflowStatuses.map((s) => ({
    key: s.code,
    code: s.code,
    name: s.name,
  }));

  const columns: ColumnsType<StatusRow> = [
    {
      title: "Code",
      dataIndex: "code",
      key: "code",
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    { title: "Name", dataIndex: "name", key: "name" },
  ];

  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="MDR records" value={mdr.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Documents" value={documents.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Notifications" value={notifications.length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Unread" value={unread} valueStyle={{ color: unread > 0 ? "#cf1322" : "#3f8600" }} />
          </Card>
        </Col>
      </Row>

      <Card title="Review codes (editable from backend)">
        <Table columns={columns} dataSource={statusRows} pagination={false} />
      </Card>
    </>
  );
}

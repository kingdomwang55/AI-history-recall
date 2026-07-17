import { HealthDashboard } from "@/components/HealthDashboard";
import { getHealthReport, redactHealthReport } from "@/services/health-check-service";

export const dynamic = "force-dynamic";

export default function HealthPage() {
  const report = redactHealthReport(getHealthReport());

  return (
    <div>
      <header className="page-header">
        <div>
          <h1 className="page-title">运行健康</h1>
          <p className="page-description">检查本地存储、检索索引、采集链路和可选模型配置。</p>
        </div>
      </header>
      <HealthDashboard initialReport={report} />
    </div>
  );
}

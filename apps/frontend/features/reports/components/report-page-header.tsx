interface ReportPageHeaderProps {
  title: string;
  description?: string;
}

/** Tiêu đề trang Báo cáo (H1 + mô tả) — đồng nhất với các trang khác. */
export function ReportPageHeader({ title, description }: ReportPageHeaderProps) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

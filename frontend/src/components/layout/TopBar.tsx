import { ReactNode } from "react";

interface TopBarProps {
  title: string;
  actions?: ReactNode;
}

export default function TopBar({ title, actions }: TopBarProps) {
  return (
    <header className="app-topbar">
      <h1>{title}</h1>
      {actions && <div className="app-topbar-actions">{actions}</div>}
    </header>
  );
}

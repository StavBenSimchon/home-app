import { useNavigate } from "react-router-dom";

interface AppBoxProps {
  title: string;
  description: string;
  icon: string;
  path: string;
}

export default function AppBox({ title, description, icon, path }: AppBoxProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "1.5rem",
        cursor: "pointer",
        textAlign: "left",
        color: "var(--text)",
        transition: "background 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-hover)";
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface)";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>{icon}</div>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.35rem" }}>
        {title}
      </h2>
      <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
        {description}
      </p>
    </button>
  );
}

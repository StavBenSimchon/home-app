import AppBox from "./AppBox";

const apps = [
  {
    title: "Fitness",
    description: "Track goals, workouts, and progress",
    icon: "🏋️",
    path: "/fitness",
  },
  {
    title: "Settle Up",
    description: "Split expenses and settle debts",
    icon: "💰",
    path: "/settle-up",
  },
];

export default function Dashboard() {
  return (
    <main className="responsive-container">
      <h1 style={{ fontSize: "clamp(1.5rem, 5vw, 2rem)", fontWeight: 700, marginBottom: "0.5rem" }}>
        Home
      </h1>
      <p style={{ color: "var(--text-muted)", marginBottom: "2.5rem", fontSize: "1.05rem" }}>
        Your personal dashboard
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: "1rem" }}>
        {apps.map((app) => (
          <AppBox
            key={app.title}
            title={app.title}
            description={app.description}
            icon={app.icon}
            path={app.path}
          />
        ))}
      </div>
    </main>
  );
}

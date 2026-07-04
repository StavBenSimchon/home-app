import AppBox from "./AppBox";

const apps = [
  {
    title: "Fitness",
    description: "Track goals, workouts, and progress",
    icon: "🏋️",
    path: "/fitness",
  },
];

export default function Dashboard() {
  return (
    <main
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "3rem 1.5rem",
      }}
    >
      <h1
        style={{
          fontSize: "2rem",
          fontWeight: 700,
          marginBottom: "0.5rem",
        }}
      >
        Home
      </h1>
      <p
        style={{
          color: "var(--text-muted)",
          marginBottom: "2.5rem",
          fontSize: "1.05rem",
        }}
      >
        Your personal dashboard
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "1rem",
        }}
      >
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

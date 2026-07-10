import { Routes, Route } from "react-router-dom";
import Dashboard from "./components/Dashboard";
import Fitness from "./components/Fitness";
import SettleUp from "./components/SettleUp";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/fitness" element={<Fitness />} />
      <Route path="/settle-up" element={<SettleUp />} />
    </Routes>
  );
}

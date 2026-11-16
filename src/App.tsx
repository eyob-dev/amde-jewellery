import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import DigitalProfilePage from './pages/DigitalProfilePage';
import JewelleryAdminPage from './pages/JewelleryAdminPage';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DigitalProfilePage />} />
        <Route path="/admin" element={<JewelleryAdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

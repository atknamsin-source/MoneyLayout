import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Main from './pages/Main';
import Dashboard from './pages/Dashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Main />} />
        <Route path="/money/:profileId" element={<Dashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

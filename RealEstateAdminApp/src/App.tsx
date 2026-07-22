import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import ManualCrawlScreen from './screens/ManualCrawlScreen';
import ManageWpScreen from './screens/ManageWpScreen';
import CronjobScreen from './screens/CronjobScreen';
import ManageSourcesScreen from './screens/ManageSourcesScreen';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminLayout />}>
          <Route index element={<ManualCrawlScreen />} />
          <Route path="manage-wp" element={<ManageWpScreen />} />
          <Route path="sources" element={<ManageSourcesScreen />} />
          <Route path="cronjob" element={<CronjobScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

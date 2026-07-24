import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import ManageWpScreen from './screens/ManageWpScreen';
import CronjobScreen from './screens/CronjobScreen';
import ManageSourcesScreen from './screens/ManageSourcesScreen';
import RawArticlesScreen from './screens/RawArticlesScreen';
import AiConfigScreen from './screens/AiConfigScreen';
import AiPromptConfigScreen from './screens/AiPromptConfigScreen';
import NewsDetailScreen from './screens/NewsDetailScreen';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<RawArticlesScreen />} />
          <Route path="manage-wp" element={<ManageWpScreen />} />
          <Route path="news-detail/:id" element={<NewsDetailScreen />} />
          <Route path="sources" element={<ManageSourcesScreen />} />
          <Route path="ai-config" element={<AiConfigScreen />} />
          <Route path="ai-prompt-config" element={<AiPromptConfigScreen />} />
          <Route path="cronjob" element={<CronjobScreen />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;

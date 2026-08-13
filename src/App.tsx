import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ScrollToTop } from "@/components/ScrollToTop";
import { AuthProvider } from "./contexts/AuthContext";
import { AuthBootGate } from "@/components/auth/AuthBootGate";
import { PublicRoute } from "@/components/auth/PublicRoute";
import { NotificationsRealtimeProvider } from "@/components/notifications/NotificationsRealtimeProvider";
import { SessionTimeoutGuard } from "@/components/SessionTimeoutGuard";
import { DeviceProvider } from "@/contexts/DeviceProvider";
import { AndroidNativeAppBanner } from "@/components/AndroidNativeAppBanner";
import { IOSNativeAppBanner } from "@/components/IOSNativeAppBanner";


import LandingPage from "./pages/LandingPage";

import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

import { CandidateLayout } from "./components/layout/CandidateLayout";
import { CandidateRoute } from "./components/auth/CandidateRoute";
import CandidateHome from "./pages/candidate/Home";
import Jobs from "./pages/candidate/Jobs";
import Applications from "./pages/candidate/Applications";
import Profile from "./pages/candidate/Profile";
import Triage from "./pages/candidate/Triage";
import { Navigate } from "react-router-dom";

import { AdminLayout } from "./components/layout/AdminLayout";
import { AdminRoute } from "./components/auth/AdminRoute";
import Dashboard from "./pages/admin/Dashboard";
import DashboardAnalytics from "./pages/admin/DashboardAnalytics";
import JobsManagement from "./pages/admin/JobsManagement";
import Pipelines from "./pages/admin/Pipelines";
import CorporateJobs from "./pages/admin/CorporateJobs";
import UnitsMonitor from "./pages/admin/UnitsMonitor";
import UsersPermissions from "./pages/admin/UsersPermissions";
import AuditLogs from "./pages/admin/AuditLogs";
import MonitoringDashboard from "./pages/admin/MonitoringDashboard";
import SystemHealth from "./pages/admin/SystemHealth";
import GlobalSettings from "./pages/admin/GlobalSettings";

import AIEvaluations from "./pages/admin/AIEvaluations";
import AdminTalentPool from "./pages/admin/TalentPool";
import AdminTalentPipeline from "./pages/admin/TalentPipeline";
import CareerPlans from "./pages/admin/CareerPlans";
import Scheduling from "./pages/admin/Scheduling";
import InterviewGuides from "./pages/admin/InterviewGuides";
import DocumentManagement from "./pages/admin/DocumentManagement";
import NotificationTemplates from "./pages/admin/NotificationTemplates";
import AdminNotifications from "./pages/admin/AdminNotifications";
import FAQManagement from "./pages/admin/FAQManagement";
import Migrations from "./pages/admin/Migrations";
import IntegrationTests from "./pages/admin/IntegrationTests";
import AdminProfile from "./pages/admin/AdminProfile";
import SupportTickets from "./pages/admin/SupportTickets";
import CandidatesByJob from "./pages/admin/CandidatesByJob";
import Collaborators from "./pages/admin/Collaborators";
import TestManagement from "./pages/admin/TestManagement";
import VoiceInterviewReview from "./pages/admin/VoiceInterviewReview";

import CandidateTalentPool from "./pages/candidate/TalentPool";
import CandidateFAQ from "./pages/candidate/FAQ";
import CandidateDocuments from "./pages/candidate/Documents";
import DocumentsHub from "./pages/candidate/DocumentsHub";
import CandidateNotifications from "./pages/candidate/Notifications";
import TestExecution from "./pages/candidate/TestExecution";
import MyTests from "./pages/candidate/MyTests";
import RoleSelection from "./pages/candidate/RoleSelection";
import InterviewLiveKitRoom from "./pages/candidate/InterviewLiveKitRoom";
import Messages from "./pages/candidate/Messages";
import Conversation from "./pages/candidate/Conversation";
import AdminMessages from "./pages/admin/Messages";
import AdminConversation from "./pages/admin/Conversation";
import RecruitmentLinksMetrics from "./pages/admin/RecruitmentLinksMetrics";
import LinkFunnelDashboard from "./pages/admin/LinkFunnelDashboard";

import { useCandidateTimeline } from "@/hooks/useDashboardMetrics";
import { hasActiveApplicationBlockingDiscovery } from "@/lib/applicationStatus";

function RoleSelectionGuard() {
  const { data: timeline, isLoading } = useCandidateTimeline();
  if (isLoading) return null;
  if (hasActiveApplicationBlockingDiscovery(timeline)) {
    return <Navigate to="/candidaturas" replace />;
  }
  return <RoleSelection />;
}
import Welcome from "./pages/candidate/Welcome";
import CargoTest from "./pages/candidate/CargoTest";
import AvailableUnits from "./pages/candidate/AvailableUnits";
import Standby from "./pages/candidate/Standby";
import FranchiseeCandidates from "./pages/admin/FranchiseeCandidates";

import TermsOfUse from "./pages/legal/TermsOfUse";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import PrivacyPolicyAI from "./pages/legal/PrivacyPolicyAI";
import BancoCurriculosTerms from "./pages/legal/BancoCurriculosTerms";
import VagaDireta from "./pages/public/VagaDireta";
import VagaSlug from "./pages/public/VagaSlug";
import NotFound from "./pages/NotFound";


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 2, // 2 minutes
    },
  },
});

const AppRoutes = () => {
  return (
    <Routes>

            {/* Landing Page — público, redireciona autenticados síncronamente */}
            <Route path="/" element={<PublicRoute><LandingPage /></PublicRoute>} />

            {/* Auth — público, redireciona autenticados síncronamente */}
            <Route path="/auth" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/auth/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/auth/cadastro" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/auth/recuperar-senha" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
            {/* Aliases legados */}
            <Route path="/login" element={<Navigate to="/auth" replace />} />
            <Route path="/cadastro" element={<Navigate to="/auth/cadastro" replace />} />
            <Route path="/recuperar-senha" element={<Navigate to="/auth/recuperar-senha" replace />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/termos-de-uso" element={<TermsOfUse />} />
            <Route path="/politica-de-privacidade" element={<PrivacyPolicy />} />
            <Route path="/privacidade" element={<PrivacyPolicyAI />} />
            <Route path="/termos-banco-curriculos" element={<BancoCurriculosTerms />} />
            <Route path="/v/:token" element={<VagaDireta />} />
            <Route path="/u/:unitSlug/:jobSlug/:shortCode" element={<VagaSlug />} />
            <Route path="/instalar-app" element={<Navigate to="/" replace />} />

            {/* Sala de entrevista LiveKit — acessível tanto para o candidato titular
                quanto para administradores. A própria página valida permissão. */}
            <Route path="/entrevista-online/:interviewId" element={<InterviewLiveKitRoom />} />

            {/* Candidate (protected) */}
            {/* Onboarding de primeiro acesso (sem layout — tela cheia) */}
            <Route element={<CandidateRoute />}>
              <Route path="/bem-vindo" element={<Welcome />} />
            </Route>

            <Route element={<CandidateRoute><CandidateLayout /></CandidateRoute>}>
              <Route path="/inicio" element={<CandidateHome />} />
              <Route path="/oportunidades" element={<RoleSelectionGuard />} />
              <Route path="/teste-cargo/:jobId" element={<CargoTest />} />
              <Route path="/unidades-disponiveis" element={<AvailableUnits />} />
              <Route path="/vagas" element={<Navigate to="/oportunidades" replace />} />
              <Route path="/banco-de-talentos" element={<CandidateTalentPool />} />
              <Route path="/banco-talentos" element={<CandidateTalentPool />} />              <Route path="/lista-oportunidade" element={<Standby />} />              <Route path="/candidaturas" element={<Applications />} />
              <Route path="/triagem/:applicationId" element={<Triage />} />
              <Route path="/documentos" element={<DocumentsHub />} />
              <Route path="/documentos/:applicationId" element={<CandidateDocuments />} />
              <Route path="/notificacoes" element={<CandidateNotifications />} />
              <Route path="/faq" element={<CandidateFAQ />} />
              <Route path="/meus-testes" element={<MyTests />} />
              <Route path="/testes/:assignmentId" element={<TestExecution />} />
              <Route path="/perfil" element={<Profile />} />
              <Route path="/mensagens" element={<Messages />} />
              <Route path="/mensagens/:threadId" element={<Conversation />} />
            </Route>

            {/* Admin */}
            <Route element={<AdminRoute><AdminLayout /></AdminRoute>}>
              <Route path="/admin" element={<Dashboard />} />
              <Route path="/admin/dashboard" element={<DashboardAnalytics />} />
              <Route path="/admin/cargos" element={<JobsManagement />} />
              <Route path="/admin/pipelines" element={<Pipelines />} />
              <Route path="/admin/vagas" element={<CorporateJobs />} />
              <Route path="/admin/vagas/:unitJobId/candidatos" element={<CandidatesByJob />} />
              <Route path="/admin/unidades" element={<UnitsMonitor />} />
              <Route path="/admin/usuarios" element={<UsersPermissions />} />
              <Route path="/admin/logs" element={<AuditLogs />} />
              <Route path="/admin/monitoramento" element={<MonitoringDashboard />} />
              <Route path="/admin/configuracoes" element={<GlobalSettings />} />
              
              <Route path="/admin/saude-sistema" element={<SystemHealth />} />
              <Route path="/admin/ia-avaliacoes" element={<AIEvaluations />} />
              <Route path="/admin/entrevistas-ia" element={<VoiceInterviewReview />} />
              <Route path="/admin/banco-de-talentos" element={<AdminTalentPool />} />
              <Route path="/admin/talent-pipeline" element={<AdminTalentPipeline />} />
              <Route path="/admin/plano-carreira" element={<CareerPlans />} />
              <Route path="/admin/agendamento" element={<Scheduling />} />
              <Route path="/admin/roteiros" element={<InterviewGuides />} />
              <Route path="/admin/documentacao" element={<DocumentManagement />} />
              <Route path="/admin/notificacoes" element={<NotificationTemplates />} />
              <Route path="/admin/minhas-notificacoes" element={<AdminNotifications />} />
              <Route path="/admin/faq" element={<FAQManagement />} />
              <Route path="/admin/migracoes" element={<Migrations />} />
              <Route path="/admin/integracoes" element={<IntegrationTests />} />
              <Route path="/admin/colaboradores" element={<Collaborators />} />
              <Route path="/admin/testes" element={<TestManagement />} />
              <Route path="/admin/chamados" element={<SupportTickets />} />
              <Route path="/admin/candidatos-disponiveis" element={<FranchiseeCandidates />} />
              <Route path="/admin/perfil" element={<AdminProfile />} />
              <Route path="/admin/mensagens" element={<AdminMessages />} />
              <Route path="/admin/mensagens/:threadId" element={<AdminConversation />} />
              <Route path="/admin/links-recrutamento" element={<RecruitmentLinksMetrics />} />
              <Route path="/admin/dashboard-links" element={<LinkFunnelDashboard />} />
              
              <Route path="/admin/vagas-corporativas" element={<Navigate to="/admin/vagas" replace />} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<NotFound />} />
          </Routes>
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DeviceProvider>
          <Toaster />
          <Sonner />
          <AndroidNativeAppBanner />
          <IOSNativeAppBanner />
          <BrowserRouter>
            <ScrollToTop />
            <AuthProvider>
              <SessionTimeoutGuard />
              <AuthBootGate>
                <NotificationsRealtimeProvider>
                  <AppRoutes />
                </NotificationsRealtimeProvider>
              </AuthBootGate>
            </AuthProvider>
          </BrowserRouter>
        </DeviceProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};


export default App;

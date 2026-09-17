import React, { useEffect } from "react";
import "./App.css";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { ToastProvider } from "./context/ToastContext";
import Toast from "./components/Toast";

import Home from "./pages/Home";
import Resources from "./pages/Resources";
import NewsList from "./pages/NewsList";
import NewsDetail from "./pages/NewsDetail";
import MyProfile from "./pages/MyProfile";
import ProductDetail from "./pages/ProductDetail";
import Team from "./pages/Team";
import Invite from "./pages/Invite";
import Cards from "./pages/Cards";
import Orders from "./pages/Orders";
import VehicleIncome from "./pages/VehicleIncome";
import Tasks from "./pages/Tasks";
import Fragments from "./pages/Fragments";
import FragmentDetail from "./pages/FragmentDetail";
import FragmentClaims from "./pages/FragmentClaims";
import Coupons from "./pages/Coupons";
import InviteRewards from "./pages/InviteRewards";
import Contract from "./pages/Contract";
import Gift from "./pages/Gift";
import Settings from "./pages/Settings";
import About from "./pages/About";
import Admin from "./pages/Admin";
import Login from "./pages/Login";
import Register from "./pages/Register";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function BodyClass() {
  useEffect(() => {
    document.body.classList.add("single-screen");
    return () => document.body.classList.remove("single-screen");
  }, []);
  return null;
}

function App() {
  return (
    <ToastProvider>
      <HashRouter>
        <BodyClass />
        <ScrollToTop />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/news" element={<NewsList />} />
          <Route path="/news/:id" element={<NewsDetail />} />
          <Route path="/my" element={<MyProfile />} />
          <Route path="/product/:id" element={<ProductDetail />} />
          <Route path="/team" element={<Team />} />
          <Route path="/invite" element={<Invite />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/vehicle-income" element={<VehicleIncome />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/fragments" element={<Fragments />} />
          <Route path="/fragments/:id" element={<FragmentDetail />} />
          <Route path="/fragment-claims" element={<FragmentClaims />} />
          <Route path="/coupons" element={<Coupons />} />
          <Route path="/invite-rewards" element={<InviteRewards />} />
          <Route path="/contract" element={<Contract />} />
          <Route path="/gift" element={<Gift />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
        <Toast />
      </HashRouter>
    </ToastProvider>
  );
}

export default App;

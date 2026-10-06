import { useState } from "react";
import { Link, useNavigate } from "react-router";

export default function GuestRegister() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: ""
  });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleRegister(e) {
    e.preventDefault();
    
    if (!formData.fullName || !formData.email || !formData.phone || !formData.password || !formData.confirmPassword) {
      setError("Please fill in all required fields.");
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match. Please check again.");
      return;
    }

    setError("");
    alert("Registration successful!");
    navigate("/guest/login");
  }

  return (
    <section style={{ maxWidth: "500px", margin: "2rem auto", padding: "1rem" }}>
      <p className="eyebrow" style={{ textAlign: "center" }}>GUEST PORTAL</p>
      <h1 style={{ textAlign: "center", marginBottom: "1.5rem" }}>Create Your Account</h1>

      <div style={{ background: "#fdfbf7", padding: "2.5rem 2rem", borderRadius: "10px", border: "1px solid #e2d9cc", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
        
        {error && (
          <div style={{ background: "#f8d7da", color: "#721c24", padding: "12px", borderRadius: "6px", marginBottom: "1.5rem", border: "1px solid #f5c6cb", fontSize: "0.9rem", textAlign: "center" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          
          {/* Personal Details Group */}
          <div>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.8rem", color: "#4a3b32", borderBottom: "1px solid #e2d9cc", paddingBottom: "4px" }}>Personal Details</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.8rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", fontSize: "0.95rem" }}>Full Name:</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="Enter your full name"
                  style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", fontSize: "0.95rem" }}>Phone Number:</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="Enter your phone number"
                  style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Account Details Group */}
          <div style={{ marginTop: "0.5rem" }}>
            <h3 style={{ fontSize: "1.1rem", marginBottom: "0.8rem", color: "#4a3b32", borderBottom: "1px solid #e2d9cc", paddingBottom: "4px" }}>Account Credentials</h3>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "0.8rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", fontSize: "0.95rem" }}>Email Address:</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="Enter your email"
                  style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", fontSize: "0.95rem" }}>Password:</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Create a password"
                  style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", marginBottom: "5px", fontWeight: "600", fontSize: "0.95rem" }}>Confirm Password:</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="Confirm your password"
                  style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
                  required
                />
              </div>
            </div>
          </div>

          <button 
            type="submit" 
            className="button" 
            style={{ width: "100%", padding: "12px", marginTop: "0.8rem", fontSize: "1rem", fontWeight: "bold", cursor: "pointer" }}
          >
            Create Account
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.9rem" }}>
          <p>Already have an account? <Link to="/guest/login" style={{ color: "#8c6d46", fontWeight: "bold", textDecoration: "underline" }}>Sign In</Link></p>
        </div>
      </div>
    </section>
  );
}
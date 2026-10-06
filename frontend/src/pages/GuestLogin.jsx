import { useState } from "react";
import { Link, useNavigate } from "react-router";

export default function GuestLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  function handleLogin(e) {
    e.preventDefault();
    
    // වැරදි හෝ හිස් ඉන්පුට් සඳහා එරර් මැසේජස් හැසිරවීම
    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    // සාම්පල් ලොගින් පරීක්ෂාව
    if (email === "lakshan@gmail.com" && password === "123456") {
      setError("");
      alert("Login successful!");
      navigate("/guest/profile");
    } else {
      setError("Invalid email or password. Please try again.");
    }
  }

  return (
    <section style={{ maxWidth: "450px", margin: "2rem auto", padding: "1rem" }}>
      <p className="eyebrow" style={{ textAlign: "center" }}>GUEST PORTAL</p>
      <h1 style={{ textAlign: "center", marginBottom: "1.5rem" }}>Sign In to Your Account</h1>

      <div style={{ background: "#fdfbf7", padding: "2.5rem 2rem", borderRadius: "10px", border: "1px solid #e2d9cc", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
        
        {error && (
          <div style={{ background: "#f8d7da", color: "#721c24", padding: "12px", borderRadius: "6px", marginBottom: "1.5rem", border: "1px solid #f5c6cb", fontSize: "0.9rem", textAlign: "center" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.95rem" }}>Email Address:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
              required
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "6px", fontWeight: "600", fontSize: "0.95rem" }}>Password:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              style={{ padding: "10px 12px", width: "100%", borderRadius: "6px", border: "1px solid #ccc", fontSize: "1rem" }}
              required
            />
          </div>

          <button 
            type="submit" 
            className="button" 
            style={{ width: "100%", padding: "12px", marginTop: "0.5rem", fontSize: "1rem", fontWeight: "bold", cursor: "pointer" }}
          >
            Sign In
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: "1.5rem", fontSize: "0.9rem" }}>
          <p>Don't have an account? <Link to="/guest/register" style={{ color: "#8c6d46", fontWeight: "bold", textDecoration: "underline" }}>Register here</Link></p>
        </div>
      </div>
    </section>
  );
}
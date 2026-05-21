# Eduspear
Here is a clean, comprehensive, and professional `README.md` tailored specifically for your [Eduspear](https://github.com/Ankitbhalke137/Eduspear) repository. It highlights your technical stack, the End-to-End Encryption, and the specific routing/deployment configurations you've set up.

---

# Eduspear

**Eduspear** is a secure, full-stack educational and collaborative networking platform. Designed with privacy at its core, the platform integrates **End-to-End Encryption (E2EE)** to ensure all user communications and shared data remain completely private and secure.

The application utilizes a decoupled architecture featuring a responsive React frontend and a robust Node.js/Express backend, optimized for instant deployment on cloud environments like Render.

---

## 🚀 Features

* **End-to-End Encryption (E2EE):** Cryptographic privacy layers securing user chats, data exchanges, and networking features.
* **Full-Stack Separation:** Organized into a clear `/client` (React) and `/server` (Node.js/Express) structure for easy scalability.
* **Optimized API Routing:** Pre-configured route ordering ensuring that administrative/backend API endpoints resolve seamlessly before handing off to the wildcard React fallback router.
* **One-Click Deployment Support:** Root-level dependency automation configures the project to install and build both front and back ends smoothly on hosting platforms like Render.

---

## 🛠️ Tech Stack

* **Frontend:** JavaScript, React, CSS3, HTML5
* **Backend:** Node.js, Express.js
* **Security:** End-to-End Encryption (E2EE) Protocols
* **Deployment:** Render

---

## 📦 Directory Structure

```text
Eduspear/
├── client/          # React frontend application
├── server/          # Node.js & Express backend application
├── package.json     # Root configuration for automated multi-package installations
└── README.md        # Project documentation

```

---

## 💻 Getting Started

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Local Installation

1. **Clone the repository:**
```bash
git clone https://github.com/Ankitbhalke137/Eduspear.git
cd Eduspear

```


2. **Install Dependencies:**
The root `package.json` is configured to automatically install dependencies for both the server and the client in a single command:
```bash
npm install

```


3. **Run the Application:**
*To run the backend server:*
```bash
cd server && npm start

```


*To run the frontend client:*
```bash
cd client && npm start

```



---

## 🌐 Deployment

This repository is optimized for deployment on **Render**.

Because of the explicit routing setup:

1. All API routes (such as `/api/admin` or data fetchers) are processed first.
2. The server seamlessly hands over any non-API traffic to the compiled React single-page application (SPA) fallback route, preventing standard `404` routing errors on client refresh.

Live Preview available here: **[fun-chat-wnow.onrender.com](https://fun-chat-wnow.onrender.com/)**

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

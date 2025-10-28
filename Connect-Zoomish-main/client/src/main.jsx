/**
 * 🎯 FILE PURPOSE: React application entry point - starts the entire frontend
 * 📍 LOCATION: client/src/main.jsx - This is where React begins running
 * 🔗 DEPENDENCIES: React library, App.jsx component, index.html (root div)
 * 📤 EXPORTS: Nothing (this is the starting point, not a module)
 * 📥 IMPORTS: React, createRoot from React 18, App component
 * 🎮 USAGE: Automatically loaded by index.html via <script src="/src/main.jsx">
 * 🐛 COMMON ISSUES: Missing root div, App.jsx import errors, React version conflicts
 * 👤 BEGINNER NOTES: Think of this as the "ignition key" for the React app
 * 
 * 📖 WHAT THIS FILE DOES:
 * 1. Imports React and the main App component
 * 2. Finds the HTML element with id="root" in index.html
 * 3. Creates a React "root" (React 18 way of starting apps)
 * 4. Renders the App component inside the root element
 * 
 * 🔍 KEY CONCEPTS FOR BEGINNERS:
 * - React: JavaScript library for building user interfaces
 * - createRoot: React 18's new way to start an app (replaces ReactDOM.render)
 * - JSX: Special syntax that lets you write HTML-like code in JavaScript
 * - Component: Reusable piece of UI (App is the main component)
 * - DOM: The webpage structure that browsers understand
 */

// 📦 IMPORTS: Get the tools we need
// client/src/main.jsx
import React from 'react';                    // React library for building UIs
import { createRoot } from 'react-dom/client'; // React 18 way to start apps
import App from './App.jsx';                   // Our main application component

// 🎯 STEP 1: Find the container in the HTML page
// BEGINNER: This looks for <div id="root"></div> in index.html
const el = document.getElementById('root');

// 🚀 STEP 2: Start the React application
// BEGINNER: This is like saying "React, take over this div and show our app!"
// createRoot(el) = "React, control this element"
// .render(<App />) = "Show the App component inside it"
createRoot(el).render(<App />);


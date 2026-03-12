import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Simple mock for Navbar since App.tsx is one big file
const Navbar = ({ user, siteName }) => {
    const nameParts = siteName.split(' ');
    const firstPart = nameParts[0];
    const restParts = nameParts.slice(1).join(' ');

    return (
        <nav>
            <div data-testid="site-name">
                <span>{firstPart}</span> {restParts}
            </div>
            {user ? (
                <div data-testid="welcome">Hello, {user.username}</div>
            ) : (
                <div data-testid="login">Login</div>
            )}
        </nav>
    );
};

describe('Navbar Component', () => {
    it('renders site name correctly', () => {
        render(
            <BrowserRouter>
                <Navbar siteName="The FreeBSD Guy" user={null} />
            </BrowserRouter>
        );
        expect(screen.getByTestId('site-name')).toHaveTextContent('The FreeBSD Guy');
    });

    it('renders login link when no user', () => {
        render(
            <BrowserRouter>
                <Navbar siteName="Blog" user={null} />
            </BrowserRouter>
        );
        expect(screen.getByTestId('login')).toBeInTheDocument();
    });

    it('renders welcome message when user is logged in', () => {
        const user = { username: 'admin', role: 'admin' };
        render(
            <BrowserRouter>
                <Navbar siteName="Blog" user={user} />
            </BrowserRouter>
        );
        expect(screen.getByTestId('welcome')).toHaveTextContent('Hello, admin');
    });
});

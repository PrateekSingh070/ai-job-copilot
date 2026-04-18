import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./providers/AuthProvider";

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock("./lib/api", () => ({
  api: {
    get: getMock,
    post: postMock,
    patch: patchMock,
    delete: deleteMock,
  },
}));

describe("Frontend auth + create job flow", () => {
  beforeEach(() => {
    localStorage.clear();
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
  });

  it("logs in and creates a job", async () => {
    getMock.mockImplementation((url: string) => {
      if (url === "/jobs")
        return Promise.resolve({ data: { success: true, data: [] } });
      if (url === "/jobs/metrics/summary") {
        return Promise.resolve({
          data: {
            data: {
              totalApplications: 0,
              interviewRate: 0,
              offerRate: 0,
              stageDistribution: {},
            },
          },
        });
      }
      if (url === "/ai/history")
        return Promise.resolve({ data: { success: true, data: [] } });
      return Promise.resolve({ data: { data: {} } });
    });

    postMock.mockImplementation((url: string) => {
      if (url === "/auth/login") {
        return Promise.resolve({
          data: {
            data: {
              accessToken: "token-1",
              user: { id: "u1", name: "Demo", email: "demo@copilot.local" },
            },
          },
        });
      }
      if (url === "/jobs") {
        return Promise.resolve({
          data: {
            data: { id: "j1", company: "Acme", role: "Dev", status: "APPLIED" },
          },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    const queryClient = new QueryClient();
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await screen.findByText(/welcome, demo/i);

    fireEvent.change(screen.getByPlaceholderText("Company"), {
      target: { value: "Acme" },
    });
    fireEvent.change(screen.getByPlaceholderText("Role"), {
      target: { value: "Full Stack Intern" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add job/i }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/jobs", expect.anything()),
    );
  });
});

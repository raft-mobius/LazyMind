//go:generate goversioninfo -icon=../../resources/icons/icon.ico

package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	exeDir, err := filepath.Abs(filepath.Dir(os.Args[0]))
	if err != nil {
		os.Exit(1)
	}

	env := buildEnv(exeDir)

	coreCmd, err := startCore(exeDir, env)
	if err != nil {
		os.Exit(1)
	}

	if !waitForHealth("http://127.0.0.1:8001/health", 30*time.Second) {
		killProcess(coreCmd)
		os.Exit(1)
	}

	electronEnv := append(env,
		"ELECTRON_RENDERER_DIR="+filepath.Join(exeDir, "renderer"),
		"LAZYMIND_DEV_MODE=true",
	)

	electronCmd, err := startElectron(exeDir, electronEnv)
	if err != nil {
		killProcess(coreCmd)
		os.Exit(1)
	}

	electronCmd.Wait()
	killProcess(coreCmd)
}

func buildEnv(exeDir string) []string {
	env := os.Environ()
	extra := map[string]string{
		"LAZYMIND_DEV_ROOT":      exeDir + string(filepath.Separator),
		"ACL_DB_DRIVER":          "sqlite",
		"ACL_DB_DSN":             filepath.Join(exeDir, "data", "main.db"),
		"LAZYMIND_STATE_BACKEND": "memory",
		"LAZYMIND_MODE":          "desktop",
		"LAZYMIND_JWT_SECRET":    "lazymind-desktop-local-dev",
		"SERVER_PORT":            "8001",
		"SERVER_HOST":            "127.0.0.1",
	}
	for k, v := range extra {
		env = append(env, k+"="+v)
	}
	return env
}

func startCore(exeDir string, env []string) (*exec.Cmd, error) {
	corePath := filepath.Join(exeDir, "bin", "core.exe")
	cmd := exec.Command(corePath)
	cmd.Env = env
	cmd.Dir = exeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func startElectron(exeDir string, env []string) (*exec.Cmd, error) {
	electronPath := filepath.Join(exeDir, "electron", "electron.exe")
	cmd := exec.Command(electronPath)
	cmd.Env = env
	cmd.Dir = exeDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW: suppress console, don't hide GUI
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

func waitForHealth(url string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 2 * time.Second}
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == 200 {
				return true
			}
		}
		time.Sleep(time.Second)
	}
	return false
}

func killProcess(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	kill := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", cmd.Process.Pid))
	kill.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}
	kill.Run()
}

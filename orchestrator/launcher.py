import os
import sys
import subprocess
import time

def check_install(package):
    try:
        __import__(package)
        return True
    except ImportError:
        return False

def main():
    print("=== Neural Orchestrator Launcher ===")
    
    # 1. Check for required packages
    required = ["torch", "torchvision", "fastapi", "uvicorn"]
    missing = [p for p in required if not check_install(p)]
    
    if missing:
        print(f"Installing missing dependencies: {', '.join(missing)}...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "torch", "torchvision", "fastapi", "uvicorn[standard]"])
            print("Dependencies installed successfully.")
        except Exception as e:
            print(f"Error installing dependencies: {e}")
            sys.exit(1)
    
    # 2. Start the service
    print("Starting FastAPI service on port 7861...")
    service_path = os.path.join(os.path.dirname(__file__), "service.py")
    
    try:
        # Run uvicorn as a subprocess to keep this launcher active or just exec
        os.environ["PYTHONPATH"] = os.path.dirname(__file__)
        subprocess.check_call([
            sys.executable, "-m", "uvicorn", 
            "service:app", "--host", "127.0.0.1", "--port", "7861", "--reload"
        ])
    except KeyboardInterrupt:
        print("\nOrchestrator stopped by user.")
    except Exception as e:
        print(f"Orchestrator crashed: {e}")

if __name__ == "__main__":
    main()

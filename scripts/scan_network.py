import socket
import requests
import os

def check_port(ip, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((ip, port)) == 0

def get_vllm_models(url):
    try:
        res = requests.get(f"{url}/v1/models", timeout=2)
        if res.status_code == 200:
            return res.json()
    except:
        pass
    return None

def main():
    hostname = socket.gethostname()
    try:
        local_ip = socket.gethostbyname(hostname)
    except:
        local_ip = "127.0.0.1"
        
    if local_ip == "127.0.0.1":
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            local_ip = s.getsockname()[0]
        except:
            pass
        finally:
            s.close()

    ip_parts = local_ip.split(".")
    if len(ip_parts) == 4:
        base_ip = f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}."
    else:
        base_ip = "192.168.1." # Fallback
    ports = [8000, 8080, 11434, 5000]
    
    print(f"Scanning {base_ip} subnet for vLLM/Ollama endpoints...")
    
    # Check localhost first
    for port in ports:
        if check_port("127.0.0.1", port):
            url = f"http://127.0.0.1:{port}"
            models = get_vllm_models(url)
            if models:
                print(f"FOUND vLLM-compatible endpoint: {url}")
                print(f"Models: {[m['id'] for m in models.get('data', [])]}")
    
    # Scan common targets or range
    for i in range(1, 100):
        ip = f"{base_ip}{i}"
        for port in ports:
            if check_port(ip, port):
                url = f"http://{ip}:{port}"
                models = get_vllm_models(url)
                if models:
                    print(f"FOUND vLLM-compatible endpoint: {url}")
                    print(f"Models: {[m['id'] for m in models.get('data', [])]}")

if __name__ == "__main__":
    main()

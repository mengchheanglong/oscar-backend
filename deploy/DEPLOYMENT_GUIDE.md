# Complete Oracle Cloud "Always Free" Deployment Guide

This guide walks you through deploying the complete **Continuum** stack on an **Oracle Cloud Infrastructure (OCI) Always Free** virtual machine for **$0/month forever**.

---

## 🏗️ Architecture Overview

The production deployment runs as an isolated, containerized stack behind Caddy:

```
[Public Internet]
       │ (Ports 80 & 443)
       ▼
 ┌───────────────┐
 │ Caddy Proxy   │  <─── Automated Let's Encrypt TLS / HTTPS & Gzip Compression
 └───────┬───────┘
         │
    ┌────┴────────────────────────┐
    │                             │
    ▼ (/api/*)                    ▼ (/*)
┌─────────────────┐       ┌─────────────────┐
│ NestJS Backend  │       │ Next.js App     │
│ (Node 24 Slim)  │       │ (Standalone UI) │
└───────┬─────────┘       └─────────────────┘
        │
   ┌────┴─────────────────┐
   ▼                      ▼
┌──────────────────┐  ┌──────────────────┐
│ PostgreSQL 17    │  │ Redis 7          │
│ (with pgvector)  │  │ (Cache & Jobs)   │
└──────────────────┘  └──────────────────┘
```

- **Zero Third-Party Cookie Issues**: Frontend and Backend share the exact same origin (`APP_ORIGIN`), ensuring session cookies (`SameSite=Lax`, `HttpOnly`) work reliably across all modern browsers.
- **Enterprise Security**: Database (`5432`) and Redis (`6379`) are strictly bound to Docker's internal private bridge network. Only ports `80` and `443` are exposed to the internet.
- **Zero Cost**: Runs entirely within Oracle Cloud's permanent **Always Free** tier limits (Ampere A1 ARM: 4 OCPU, 24 GB RAM, 200 GB NVMe).

---

## 📋 Prerequisites

1. An **Oracle Cloud Free Tier** account ([Sign up here](https://www.oracle.com/cloud/free/)).
2. An SSH client on your computer (Terminal on macOS/Linux or PowerShell / PuTTY on Windows).

---

## 🚀 Step 1: Create the Always Free VM Instance

1. Log into your [Oracle Cloud Console](https://cloud.oracle.com/).
2. In the navigation menu (top-left hamburger), go to **Compute** ➔ **Instances**.
3. Click **Create Instance**.
4. Configure the following settings:
   - **Name**: `ai-workspace-server` (or any name you prefer).
   - **Placement**: Leave default Availability Domain.
   - **Image and Shape**:
     - Click **Change Image**: Select **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS** (Minimal or Standard).
     - Click **Change Shape**:
       - Select **Ampere (ARM)** ➔ **VM.Standard.A1.Flex** (Always Free Eligible).
       - Select **2 to 4 OCPU** and **12 to 24 GB RAM** (Oracle provides up to 4 OCPUs and 24 GB RAM for free).
         _(Note: If Ampere is temporarily out of capacity in your chosen region, choose AMD `VM.Standard.E2.1.Micro` with 1 OCPU and 1 GB RAM, which is also Always Free)._
   - **Networking**:
     - Select **Create new virtual cloud network** and **Create new public subnet**.
     - Ensure **Assign a public IPv4 address** is checked (**Yes**).
   - **Add SSH keys**:
     - Choose **Generate a key pair for me** and click **Save Private Key** to download `ssh-key-....key` to your computer.
       _(Or paste your existing public SSH key if you already have one)._
   - **Boot Volume**:
     - Leave default (50 GB to 200 GB NVMe - up to 200 GB is permanently free).
5. Click **Create** at the bottom.
6. Wait 1–2 minutes until the instance state changes from _Provisioning_ to **Running**.
7. Note down your **Public IP Address** (e.g. `150.136.x.x`).

---

## 🔒 Step 2: Open Ingress Ports (80 & 443) in Oracle VCN

By default, Oracle Cloud blocks all incoming traffic except port 22 (SSH). You must allow ports 80 and 443 in your Virtual Cloud Network (VCN):

1. On your instance details page, under **Instance details**, click on your **Subnet** link (e.g., `subnet-xxxx`).
2. Click on the **Default Security List for vcn-xxxx**.
3. Under **Ingress Rules**, click **Add Ingress Rules**.
4. Add the HTTP and HTTPS rules:
   - **Source Type**: `CIDR`
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `80,443`
   - **Description**: `Allow HTTP and HTTPS for Continuum`
5. Click **Add Ingress Rules**.

---

## 💻 Step 3: Run the Automated Deployment

1. Open PowerShell or Terminal on your local machine.
2. Connect to your Oracle Cloud instance via SSH:
   ```bash
   # If you downloaded an SSH key:
   chmod 400 path/to/your-key.key # (macOS/Linux)
   ssh -i path/to/your-key.key ubuntu@<YOUR_PUBLIC_IP>
   ```
3. Once logged into the server, run the single-command automated installer:
   ```bash
   curl -sSL https://raw.githubusercontent.com/mengchheanglong/AI-Workspace-backend/main/deploy/setup-oracle-vm.sh | bash
   ```
4. The automated installer will:
   - Verify the CPU architecture (ARM64 / x86_64).
   - Configure a 2GB swap file.
   - Configure the OS firewall (`iptables` and `ufw`) to accept connections on ports 80 and 443.
   - Install Docker and Docker Compose.
   - Clone both Backend and Frontend repositories.
   - Generate secure passwords and `.env.production`.
   - Build and start all 5 containers (`caddy`, `frontend`, `backend`, `postgres`, `redis`).
   - Run TypeORM release migrations.
   - Verify system health checks.

5. At the end of the installation, a summary banner will display:
   - **Access URL**: `http://<YOUR_PUBLIC_IP>`
   - **Admin Email**: `admin@aiworkspace.local`
   - **Admin Password**: (Generated strong password)
   - **Swagger API Docs**: `http://<YOUR_PUBLIC_IP>/api/docs`

---

## 🌐 Step 4: Adding a Custom Domain with Free Automated HTTPS (Optional)

If you have a domain (or use a free DuckDNS / Cloudflare domain):

1. In your domain registrar / DNS provider, add an **A Record**:
   - **Type**: `A`
   - **Name**: `workspace` (or `@` for apex domain)
   - **Value**: `<YOUR_ORACLE_PUBLIC_IP>`
2. SSH into your Oracle Cloud VM and edit the `.env.production` file:
   ```bash
   nano /opt/ai-workspace/.env.production
   ```
3. Update the `DOMAIN` and `APP_ORIGIN` lines:
   ```env
   DOMAIN=workspace.yourdomain.com
   APP_ORIGIN=https://workspace.yourdomain.com
   ```
4. Restart the Caddy and Backend containers:
   ```bash
   cd /opt/ai-workspace
   sudo docker compose -f docker-compose.prod.yml restart caddy backend
   ```

Caddy will automatically obtain a valid Let's Encrypt TLS certificate and enable HTTPS on port 443 with automatic HTTP-to-HTTPS redirection.

---

## ⚙️ Maintenance & Operations

All commands are run from the `/opt/ai-workspace` directory on your server:

### View Live Logs

```bash
cd /opt/ai-workspace
# View all logs
sudo docker compose -f docker-compose.prod.yml logs -f

# View backend only
sudo docker compose -f docker-compose.prod.yml logs -f backend

# View frontend only
sudo docker compose -f docker-compose.prod.yml logs -f frontend
```

### Restart Services

```bash
sudo docker compose -f /opt/ai-workspace/docker-compose.prod.yml restart
```

### Pull Updates & Rebuild

```bash
cd /opt/ai-workspace
git -C backend pull origin main
git -C frontend pull origin main
sudo docker compose -f docker-compose.prod.yml up -d --build
```

### Backup PostgreSQL Database

```bash
sudo docker exec -t ai-workspace-postgres pg_dump -U ai_workspace ai_workspace > /opt/ai-workspace/backup_$(date +%F).sql
```

### Restore Database

```bash
cat backup_file.sql | sudo docker exec -i ai-workspace-postgres psql -U ai_workspace -d ai_workspace
```

---

## ❓ Frequently Asked Questions & Troubleshooting

### Why is my server not responding on port 80/443 even though Docker is running?

Oracle Cloud Ubuntu images include strict OS-level `iptables` rules that reject inbound connections. The setup script configures these rules automatically, but if you modified them manually, run:

```bash
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 2 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Also verify that Ingress Rules are added in your Oracle VCN Security List (Step 2).

### "Out of host capacity" error when creating Ampere A1 instance

Ampere A1 instances in certain Oracle data centers have high demand. If you see this message:

1. Try changing the Availability Domain (AD-1, AD-2, or AD-3).
2. Or change the shape to `VM.Standard.E2.1.Micro` (AMD, 1 OCPU, 1 GB RAM - also Always Free). Our 2GB swapfile configuration ensures the stack builds and runs smoothly on micro instances as well.

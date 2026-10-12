resource "openstack_networking_secgroup_v2" "relay" {
  name        = "cupli-relay"
  description = "22/80/443 tcp + 443 udp (QUIC). The bun handler's :3000 must stay closed."
}

locals {
  ingress = [
    { proto = "tcp", port = 22 },
    { proto = "tcp", port = 80 },
    { proto = "tcp", port = 443 },
    { proto = "udp", port = 443 },
  ]
}

resource "openstack_networking_secgroup_rule_v2" "ingress" {
  for_each          = { for r in local.ingress : "${r.proto}-${r.port}" => r }
  security_group_id = openstack_networking_secgroup_v2.relay.id
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = each.value.proto
  port_range_min    = each.value.port
  port_range_max    = each.value.port
  remote_ip_prefix  = "0.0.0.0/0"
}

# Selectel ignores `security_groups` on the instance (it came up with none, which
# drops all ingress); the group has to be bound to the port itself.
# The instance's network[0].port comes back empty on Selectel, so look the port up.
data "openstack_networking_port_v2" "relay" {
  device_id  = openstack_compute_instance_v2.relay.id
  network_id = openstack_networking_network_v2.relay.id
}

resource "openstack_networking_port_secgroup_associate_v2" "relay" {
  port_id            = data.openstack_networking_port_v2.relay.id
  security_group_ids = [openstack_networking_secgroup_v2.relay.id]
  enforce            = true

  # Any in-place change to the instance (e.g. a flavor resize) makes the port lookup
  # "known after apply", which would REPLACE this association: destroy strips the group
  # from the port - and on Selectel a port with no group drops all traffic. That caused
  # a ~4 min outage on 2026-10-12. The port never changes, so never follow it.
  lifecycle {
    ignore_changes = [port_id]
  }
}
